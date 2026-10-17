"""Read-only confirmation gate and crash-closed, single-writer batch registry.

This module never creates confirmation files or HTTP transports. User confirmation
is an external input, not something an agent can manufacture with a CLI switch.
The collection entry must enter authorized_session before constructing transport.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

try:
    import fcntl
except ImportError:
    fcntl = None

from .action_api import DEFAULT_API_ENDPOINT
from .evidence import ResponseCache
from .http_adapter import validate_user_agent, InvalidUserAgentError, MissingUserAgentError
from .ledger import BatchLedger, WordStatus


class GateRejected(RuntimeError):
    pass


@dataclass(frozen=True)
class AuthorizedBatch:
    binding: dict
    heads: tuple[str, ...]


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise GateRejected(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def read_json(path: Path):
    try:
        return json.loads(path.read_bytes(), object_pairs_hook=_object,
                          parse_constant=lambda value: (_ for _ in ()).throw(
                              GateRejected(f"invalid JSON constant: {value}")))
    except (OSError, ValueError) as error:
        raise GateRejected(f"unreadable JSON: {path.name}") from error


def _git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True,
                                   env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"}).strip()


def _safe_path(workspace: Path, relative: str) -> Path:
    path = Path(relative)
    if path.is_absolute() or path.as_posix() != relative or ".." in path.parts:
        raise GateRejected("paths must be canonical workspace-relative paths")
    result = workspace / path
    current = workspace
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            raise GateRejected(f"symlink outside write contract: {relative}")
    if not result.resolve().is_relative_to(workspace):
        raise GateRejected("path escapes workspace")
    return result


def build_binding(args, *, repo: Path) -> dict:
    """Derive the exact contract from invocation and immutable local inputs."""
    try:
        workspace = Path(args.workspace_root).absolute()
        if workspace != workspace.resolve() or not workspace.is_dir():
            raise GateRejected("workspace must exist, be absolute, and contain no symlink")
        repo = repo.resolve()
        if repo.parent != workspace:
            raise GateRejected("repository must be an immediate child of workspace")
        batch = args.batch_root
        if not isinstance(batch, str) or not re.fullmatch(r"ham37-[a-z0-9-]+", batch):
            raise GateRejected("invalid isolated batch root")
        paths = {
            "heads": f"{batch}/inputs/heads.txt",
            "authorization": f"{batch}/inputs/authorization.json",
            "checkpoint": f"{batch}/state/checkpoint.json",
            "registry": f"{batch}/state/authorization-registry.json",
            "lock": f"{batch}/state/authorization.lock",
            "cache": f"{batch}/cache",
            "log": f"{batch}/execution.log",
            "reports": [f"{batch}/reports/{name}" for name in
                        ("candidates.json", "candidates.md", "costs.json", "evidence.json")],
            "temporaryPrefixes": [f"{batch}/state/{name}" for name in
                                  ("checkpoint.json", "authorization-registry.json")],
        }
        for key in ("heads", "authorization", "checkpoint", "cache"):
            supplied = getattr(args, {"heads": "heads_file", "authorization": "authorization_file",
                                      "checkpoint": "checkpoint", "cache": "cache_dir"}[key])
            if supplied != paths[key]:
                raise GateRejected(f"invocation path differs from whitelist: {key}")
        if getattr(args, "current", None) is not None or getattr(args, "output", None) is not None:
            raise GateRejected("collection binding does not accept alternate current/output paths")
        for value in paths.values():
            for relative in value if isinstance(value, list) else [value]:
                _safe_path(workspace, relative)
        batch_path = _safe_path(workspace, batch)
        # Existing cache/report children also belong to the whitelist. A nested
        # symlink could otherwise redirect ResponseCache's content-addressed writes.
        for child in batch_path.rglob("*"):
            relative = child.relative_to(workspace).as_posix()
            _safe_path(workspace, relative)
            if not child.is_file() and not child.is_dir():
                raise GateRejected("non-regular batch entry")
            if child.is_file() and child.stat().st_nlink != 1:
                raise GateRejected("hard-linked batch file")
            if child.is_dir():
                if relative not in {f"{batch}/{d}" for d in ("inputs", "state", "cache", "reports")}:
                    raise GateRejected("unexpected nested batch directory")
                continue
            allowed = {paths[k] for k in ("heads", "authorization", "checkpoint", "registry", "lock", "log")}
            allowed.update(paths["reports"])
            # Proposal artifacts are read-only; collection cannot overwrite them.
            allowed.update(f"{batch}/{name}" for name in
                           ("proposal.md", "binding-proposal.json", "selection.json", "immutable-baseline.tsv"))
            if relative not in allowed and not (
                child.parent == workspace / paths["cache"] and
                re.fullmatch(r"[0-9a-f]{64}\.(body|meta\.json)", child.name)
            ):
                raise GateRejected(f"file outside batch contract: {relative}")
        raw = (workspace / paths["heads"]).read_bytes()
        heads = raw.decode("utf-8").splitlines()
        if (not heads or len(set(heads)) != len(heads) or len(heads) > 100 or
                any(not h or h != h.strip() or h.startswith("#") for h in heads)):
            raise GateRejected("head list must contain 1..100 distinct exact heads")
        if type(args.budget_heads) is not int or not len(heads) <= args.budget_heads <= 100:
            raise GateRejected("invalid distinct-head cap")
        mib = args.budget_decompressed_mib
        if type(mib) not in (int, float) or not 0 < mib <= 20 or int(mib * 1048576) != mib * 1048576:
            raise GateRejected("invalid ALL decompressed cap")
        if type(args.budget_requests) is not int or not 0 < args.budget_requests <= 600:
            raise GateRejected("explicit whole-batch request cap required (1..600)")
        validate_user_agent(args.user_agent, allow_synthetic=False)
        if (args.endpoint != DEFAULT_API_ENDPOINT or args.interval_seconds != 5 or
                args.max_retries != 2):
            raise GateRejected("only the reviewed serial Action API plan is supported")
        if not isinstance(args.execution_commit, str) or not re.fullmatch(r"[0-9a-f]{40}", args.execution_commit):
            raise GateRejected("full execution commit required")
        if (_git(repo, "rev-parse", "HEAD") != args.execution_commit or
                _git(repo, "status", "--porcelain", "--untracked-files=all")):
            raise GateRejected("execution version differs or working tree is dirty")
        return {
            "schemaVersion": 1, "batchId": "first-round", "workspaceRoot": str(workspace),
            "repository": repo.name, "executionCommit": args.execution_commit,
            "headsSha256": digest(raw), "headCount": len(heads), "userAgent": args.user_agent,
            "paths": paths,
            "calls": {"endpoint": args.endpoint,
                      "toc": {"action": "parse", "page": "exact-head", "prop": "tocdata", "format": "json", "redirects": "1"},
                      "main": {"action": "parse", "page": "exact-head", "section": "dynamic-English-level-2-number", "prop": "text", "format": "json", "redirects": "1"},
                      "optionalRequests": 0, "followHttpRedirects": False,
                      "intervalSeconds": 5, "timeoutSeconds": 30,
                      "maxRetriesPerOperation": 2, "backoffSeconds": [5, 10], "respectRetryAfter": True},
            "limits": {"distinctHeads": args.budget_heads, "decompressedBytesAll": int(mib * 1048576),
                       "requestAttempts": args.budget_requests},
            "accounting": {"networkBytes": "encoded response bodies; excludes headers/TLS/IP",
                           "decompressedBytes": "ALL bodies including TOC/MAIN/errors/retries",
                           "requests": "every dispatch attempt including known-zero failures"},
        }
    except GateRejected:
        raise
    except (AttributeError, OSError, ValueError, TypeError, RuntimeError,
            InvalidUserAgentError, MissingUserAgentError) as error:
        raise GateRejected(f"invalid binding: {error}") from error


def require_confirmation(binding: dict) -> str:
    """Read a user-supplied envelope. No grant creation/update API exists."""
    auth = read_json(Path(binding["workspaceRoot"]) / binding["paths"]["authorization"])
    if not isinstance(auth, dict) or set(auth) != {
        "schemaVersion", "granted", "synthetic", "source", "confirmation", "binding"
    }:
        raise GateRejected("strict user-confirmation envelope required")
    if (type(auth["schemaVersion"]) is not int or auth["schemaVersion"] != 1 or
            auth["granted"] is not True or auth["synthetic"] is not False or
            auth["source"] != "user-confirmation" or
            not isinstance(auth["confirmation"], str) or not auth["confirmation"].strip()):
        raise GateRejected("explicit non-synthetic user confirmation required")
    # Canonical bytes distinguish bool/int and reject extra/missing contract keys.
    if canonical(auth["binding"]) != canonical(binding):
        raise GateRejected("confirmation binding differs from invocation")
    return digest(canonical(auth))


def read_state(binding: dict) -> dict | None:
    """Preflight without mkdir, lock creation, resume(), or ledger mutation."""
    root = Path(binding["workspaceRoot"])
    cp_path = root / binding["paths"]["checkpoint"]
    reg_path = root / binding["paths"]["registry"]
    cache = root / binding["paths"]["cache"]
    if cache.exists():
        try:
            ResponseCache(cache, read_only=True)
        except (OSError, RuntimeError, ValueError, TypeError, KeyError) as error:
            raise GateRejected(f"invalid response cache: {error}") from error
    if cp_path.exists() != reg_path.exists():
        raise GateRejected("checkpoint/registry pair missing; never reset same batch")
    if not reg_path.exists():
        # Cache without a ledger cannot prove previous consumption.
        if cache.exists() and any(cache.iterdir()):
            raise GateRejected("orphan cache without consumption ledger")
        return None
    reg = read_json(reg_path)
    if not isinstance(reg, dict) or set(reg) != {
        "schemaVersion", "bindingSha256", "authorizationSha256", "phase", "revision", "checkpointSha256"
    } or reg["schemaVersion"] != 1 or type(reg["schemaVersion"]) is not int:
        raise GateRejected("invalid registry")
    if (reg["bindingSha256"] != digest(canonical(binding)) or reg["phase"] != "idle" or
            type(reg["revision"]) is not int or reg["revision"] < 1 or
            not isinstance(reg["authorizationSha256"], str) or
            not re.fullmatch(r"[0-9a-f]{64}", reg["authorizationSha256"]) or
            reg["checkpointSha256"] != digest(cp_path.read_bytes())):
        raise GateRejected("registry active, binding changed, or checkpoint rolled back/damaged")
    try:
        # Validate JSON duplicates before the ledger's structural checks.
        payload = read_json(cp_path)
        if "max_requests" not in payload["budget"] or "requestCap" not in payload["authorization"]:
            raise GateRejected("checkpoint requires explicit persisted request cap")
        ledger = BatchLedger.load(cp_path)
        cp, budget, limits = ledger.checkpoint, ledger.budget, binding["limits"]
        heads = (root / binding["paths"]["heads"]).read_text().splitlines()
        if (cp.batch_id != binding["batchId"] or cp.active_request is not None or
                cp.pause_reason is not None or
                any(entry.status == WordStatus.IN_FLIGHT for entry in cp.words.values()) or
                not set(cp.words).issubset(heads) or
                cp.retry_limit != binding["calls"]["maxRetriesPerOperation"] or
                budget.max_requests != limits["requestAttempts"] or
                budget.max_distinct_heads != limits["distinctHeads"] or
                budget.max_decompressed_bytes != limits["decompressedBytesAll"] or
                budget.request_count >= budget.max_requests or
                budget.decompressed_bytes >= budget.max_decompressed_bytes or
                budget.distinct_heads_started >= budget.max_distinct_heads or
                cp.request_seq != budget.request_count or
                sum(budget.requests_by_kind.values()) != budget.request_count or
                set(budget.requests_by_kind) - {"toc", "main"}):
            raise GateRejected("checkpoint cannot safely resume within this binding")
    except (RuntimeError, ValueError, TypeError, KeyError, AttributeError) as error:
        raise GateRejected(f"invalid ledger: {error}") from error
    return reg


def preflight(args, *, repo: Path) -> dict:
    try:
        binding = build_binding(args, repo=repo)
        auth_hash = require_confirmation(binding)
        reg = read_state(binding)
        if reg is not None and reg["authorizationSha256"] != auth_hash:
            raise GateRejected("user confirmation changed within same batch")
        return binding
    except (OSError, ValueError, TypeError) as error:
        raise GateRejected(f"unreadable authorization state: {error}") from error


def _atomic_json(path: Path, payload: dict) -> None:
    fd, name = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(canonical(payload))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextmanager
def authorized_session(args, *, repo: Path):
    """Recheck under flock; write-ahead active marker survives any interrupted run.

    Caller owns only checkpoint/cache/report writes inside the bound whitelist.
    No transport is constructed here. A raised exception deliberately leaves the
    registry active; a restart must refuse uncertain consumption rather than reset.
    """
    if fcntl is None:
        raise GateRejected("POSIX flock unavailable; no unlocked fallback")
    binding = preflight(args, repo=repo)
    root = Path(binding["workspaceRoot"])
    paths = binding["paths"]
    lock = root / paths["lock"]
    # The existing batch directory provides a zero-write bootstrap lock. A losing
    # first-run contender must not create even the state directory or lock file.
    batch_dir = (root / paths["heads"]).parents[1]
    bootstrap = os.open(batch_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    fd = None
    try:
        try:
            fcntl.flock(bootstrap, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise GateRejected("batch authorization bootstrap lock is busy") from error
        if preflight(args, repo=repo) != binding:
            raise GateRejected("binding changed while acquiring lock")
        raw_heads = (root / paths["heads"]).read_bytes()
        if digest(raw_heads) != binding["headsSha256"]:
            raise GateRejected("heads changed before session start")
        approved_heads = tuple(raw_heads.decode("utf-8").splitlines())
        previous = read_state(binding)
        reg_path = root / paths["registry"]
        registry = {
            "schemaVersion": 1, "bindingSha256": digest(canonical(binding)),
            "authorizationSha256": require_confirmation(binding), "phase": "active",
            "revision": previous["revision"] + 1 if previous else 1,
            "checkpointSha256": previous["checkpointSha256"] if previous else None,
        }
        expected = digest(canonical(previous)) if previous else None
        actual = digest(canonical(read_json(reg_path))) if reg_path.exists() else None
        if actual != expected:
            raise GateRejected("registry CAS failed")
        flags = os.O_RDONLY | os.O_NOFOLLOW
        if lock.exists():
            fd = os.open(lock, flags)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise GateRejected("authorization.lock is busy") from error
        else:
            # All rejection checks precede the first write. Bootstrap flock also
            # protects creation; the persistent lock is never unlinked/replaced.
            if not lock.parent.exists():
                lock.parent.mkdir()
            fd = os.open(lock, flags | os.O_CREAT | os.O_EXCL, 0o600)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _atomic_json(reg_path, registry)
        yield AuthorizedBatch(binding, approved_heads)
        # CAS prevents another writer from silently replacing the registry.
        if canonical(read_json(reg_path)) != canonical(registry):
            raise GateRejected("registry changed during session")
        if build_binding(args, repo=repo) != binding or require_confirmation(binding) != registry["authorizationSha256"]:
            raise GateRejected("binding or confirmation changed during session")
        cp_path = root / paths["checkpoint"]
        read_json(cp_path)
        BatchLedger.load(cp_path)  # refuse corrupt completion rather than sealing it
        registry["phase"] = "idle"
        registry["checkpointSha256"] = digest(cp_path.read_bytes())
        _atomic_json(reg_path, registry)
    finally:
        if fd is not None:
            os.close(fd)
        os.close(bootstrap)
