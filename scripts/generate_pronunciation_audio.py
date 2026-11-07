#!/usr/bin/env python3
"""按冻结词表采集 Wiktionary 关联的 Commons 录音并生成可审计 sidecar。"""
from __future__ import annotations

import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
CHANGE = ROOT / "openspec/changes/add-dictionary-pronunciation-audio"
MANIFEST_PATH = ROOT / "src/pronunciation-audio/data/pronunciation-audio.json"
COVERAGE_PATH = CHANGE / "evidence/coverage.json"
CACHE_PATH = CHANGE / "evidence/raw"
WORDS = (
    "hello", "note", "apple", "book", "world", "water", "cat", "dog", "learn", "word",
    "dictionary", "pronunciation", "read", "lead", "live", "record", "wind", "close", "minute", "present",
)
ALLOWED_API_HOSTS = {"en.wiktionary.org", "commons.wikimedia.org"}
ALLOWED_MEDIA_HOSTS = {"upload.wikimedia.org"}
ALLOWED_MIMES = {"audio/mpeg", "audio/ogg", "application/ogg", "audio/webm", "audio/mp4"}
MAX_BYTES = 2 * 1024 * 1024
MAX_DURATION = 30
USER_AGENT = "HamsterDictionary/0.1 (HAM-186; per-file pronunciation license audit)"

# 只有在当前 ECDICT 读法、Wiktionary 发音段落和指定录音全部一致时才登记。
# 该表不提供许可结论；许可始终来自本次保存的 Commons 文件元数据。
REVIEWED_READINGS: dict[str, dict[str, str]] = {
    "hello": {
        "audio": "En-uk-hello.ogg", "sourcePhonetic": "/həˈləʊ/", "currentPhonetic": "/hә'lәu/",
        "accent": "uk", "verifiedAt": "2026-11-06T14:56:27Z", "verifiedBy": "资深软件工程师（HAM-186 Apply）",
        "reviewNote": "当前 ECDICT 的 ә/'/u 记法与 UK /həˈləʊ/ 的音素和重音一致；真实查询输出带成对 /，仅对应指定的 UK 文件。",
    },
    "cat": {
        "audio": "En-us-cat.ogg", "sourcePhonetic": "/ˈkæt/", "currentPhonetic": "/kæt/",
        "accent": "us", "verifiedAt": "2026-11-06T14:56:27Z", "verifiedBy": "资深软件工程师（HAM-186 Apply）",
        "reviewNote": "单音节词省略主重音不改变音素；真实查询输出带成对 /，选择单词录音 En-us-cat.ogg，不选择短语 a cat 或地区变体。",
    },
    "dog": {
        "audio": "En-uk-dog.ogg", "sourcePhonetic": "/dɒɡ/", "currentPhonetic": "/dɒg/",
        "accent": "uk", "verifiedAt": "2026-11-06T14:56:27Z", "verifiedBy": "资深软件工程师（HAM-186 Apply）",
        "reviewNote": "g 与 ɡ 是同一 IPA 音素的字形差异；真实查询输出带成对 /，当前 UK /dɒɡ/ 仅对应指定 UK 文件。",
    },
    "dictionary": {
        "audio": "En-uk-dictionary.ogg", "sourcePhonetic": "/ˈdɪkʃ(ə)nəɹi/", "currentPhonetic": "/'dikʃәnәri/",
        "accent": "uk", "verifiedAt": "2026-11-06T14:56:27Z", "verifiedBy": "资深软件工程师（HAM-186 Apply）",
        "reviewNote": "当前读法实现来源中可选的第一个 ə；真实查询输出带成对 /，其余音素和重音一致，仅对应指定 UK 文件。",
    },
}

LICENSES = {
    "public domain": ("Public-Domain", "Public domain"),
    "cc0": ("CC0-1.0", "CC0 1.0 Universal"),
    "cc0 1.0": ("CC0-1.0", "CC0 1.0 Universal"),
    "cc by 3.0": ("CC-BY-3.0", "Creative Commons Attribution 3.0"),
    "cc by 3.0 us": ("CC-BY-3.0", "Creative Commons Attribution 3.0 United States"),
    "cc by 4.0": ("CC-BY-4.0", "Creative Commons Attribution 4.0"),
    "cc by-sa 3.0": ("CC-BY-SA-3.0", "Creative Commons Attribution ShareAlike 3.0"),
    "cc by-sa 4.0": ("CC-BY-SA-4.0", "Creative Commons Attribution ShareAlike 4.0"),
}


class CollectionError(RuntimeError):
    pass


class AssetRejected(CollectionError):
    """单个资产的许可、归因或媒体表示不合格；采集/传输错误不在此类。"""


class RetryAfterError(CollectionError):
    def __init__(self, url: str, retry_after: str):
        super().__init__(f"上游要求限流：{url}；Retry-After: {retry_after or '未提供'}")
        self.retry_after = retry_after


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def clean_html(value: str) -> str:
    parser = _TextExtractor()
    parser.feed(value)
    parser.close()
    return " ".join(html.unescape("".join(parser.parts)).split())


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def api_url(host: str, parameters: dict[str, str]) -> str:
    return f"https://{host}/w/api.php?" + urlencode(parameters)


@dataclass(frozen=True)
class CachedJson:
    value: Any
    sha256: str
    cache_ref: str


@dataclass(frozen=True)
class MediaHead:
    final_url: str
    mime: str
    bytes: int
    cache_ref: str


class CachedClient:
    def __init__(
        self,
        cache_dir: Path,
        *,
        max_requests: int = 100,
        min_interval: float = 2.0,
        transport: Callable[[Request], Any] | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.cache_dir = cache_dir
        self.max_requests = max_requests
        self.min_interval = min_interval
        self.transport = transport or urlopen
        self.sleep = sleep
        self.clock = clock
        self.requests = 0
        self.last_request: float | None = None

    def _cache_path(self, method: str, url: str) -> Path:
        key = hashlib.sha256(f"{method}\n{url}".encode()).hexdigest()
        return self.cache_dir / f"{method.lower()}-{key}.json"

    def _allow_host(self, url: str, hosts: set[str]) -> None:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username or parsed.password:
            raise CollectionError(f"拒绝未授权 URL：{url}")

    def _begin_request(self) -> None:
        if self.requests >= self.max_requests:
            raise CollectionError(f"请求限额 {self.max_requests} 已用尽")
        if self.last_request is not None:
            self.sleep(max(0.0, self.min_interval - (self.clock() - self.last_request)))
        self.requests += 1
        self.last_request = self.clock()

    def get_json(self, url: str) -> CachedJson:
        self._allow_host(url, ALLOWED_API_HOSTS)
        path = self._cache_path("GET", url)
        if path.exists():
            raw = path.read_bytes()
        else:
            self._begin_request()
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            try:
                with self.transport(request, timeout=20) as response:
                    raw = response.read(4 * 1024 * 1024 + 1)
                    if len(raw) > 4 * 1024 * 1024:
                        raise CollectionError(f"响应过大或截断：{url}")
            except HTTPError as error:
                if error.code in {429, 502, 503, 504}:
                    raise RetryAfterError(url, error.headers.get("Retry-After", "")) from error
                raise CollectionError(f"采集失败：{url} HTTP {error.code}") from error
            atomic_write(path, raw)
        try:
            value = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise CollectionError(f"响应不是完整 JSON：{path.name}") from error
        if not isinstance(value, dict) or "error" in value:
            raise CollectionError(f"API 返回错误：{path.name}")
        return CachedJson(value, hashlib.sha256(raw).hexdigest(), (str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name))

    def head_media(self, url: str) -> MediaHead:
        self._allow_host(url, ALLOWED_MEDIA_HOSTS)
        path = self._cache_path("HEAD", url)
        if path.exists():
            raw = path.read_bytes()
        else:
            self._begin_request()
            request = Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
            try:
                with self.transport(request, timeout=20) as response:
                    final_url = response.geturl()
                    parsed = urlparse(final_url)
                    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_MEDIA_HOSTS:
                        raise AssetRejected(f"重定向到未批准 host：{final_url}")
                    record = {
                        "requestedUrl": url,
                        "finalUrl": final_url,
                        "status": response.status,
                        "headers": dict(response.headers.items()),
                    }
                    raw = json_bytes(record)
            except HTTPError as error:
                if error.code in {429, 502, 503, 504}:
                    raise RetryAfterError(url, error.headers.get("Retry-After", "")) from error
                raise CollectionError(f"媒体 HEAD 失败：{url} HTTP {error.code}") from error
            atomic_write(path, raw)
        try:
            record = json.loads(raw)
            final_url = record["finalUrl"]
            parsed = urlparse(final_url)
            if parsed.scheme != "https" or parsed.hostname not in ALLOWED_MEDIA_HOSTS:
                raise AssetRejected(f"重定向到未批准 host：{final_url}")
            if record["status"] != 200:
                raise AssetRejected(f"媒体 HEAD 状态无效：{url}")
            headers = {str(key).lower(): str(value) for key, value in record["headers"].items()}
            mime = headers.get("content-type", "").split(";", 1)[0].strip().lower()
            size = int(headers.get("content-length", "0"))
        except (KeyError, ValueError, TypeError, json.JSONDecodeError) as error:
            raise CollectionError(f"媒体 HEAD 缓存无效：{path.name}") from error
        if mime not in ALLOWED_MIMES or not 0 < size <= MAX_BYTES:
            raise AssetRejected(f"媒体 MIME/大小不合格：{url} {mime} {size}")
        return MediaHead(final_url, mime, size, (str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name))


def lookup_current_phonetics() -> dict[str, str]:
    try:
        process = subprocess.run(
            ["node", "scripts/pronunciation_audio_lookup.mjs"],
            cwd=ROOT, input=json.dumps(WORDS), text=True, capture_output=True, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise CollectionError("真实 getDetail 桥接失败") from error
    if process.returncode != 0:
        raise CollectionError(f"真实 getDetail 桥接失败：{process.stderr.strip()}")
    try:
        payload = json.loads(process.stdout)
        records = payload["records"]
        if payload["schema"] != "pronunciation-audio-lookup/1" or not isinstance(records, list):
            raise ValueError("lookup schema 无效")
        if [record.get("word") for record in records] != list(WORDS):
            raise ValueError("lookup 词表或顺序不一致")
        result = {}
        for record in records:
            phonetic = record.get("phonetic")
            if phonetic is not None and (not isinstance(phonetic, str) or not phonetic.strip()):
                raise ValueError("lookup IPA 类型无效")
            if isinstance(phonetic, str) and phonetic.strip():
                result[record["word"]] = phonetic
        return result
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise CollectionError("真实 getDetail 桥接响应无效") from error


def pronunciation_section(wikitext: str) -> str | None:
    english = re.search(r"(?ms)^==English==\s*(.*?)(?=^==[^=]|\Z)", wikitext)
    if english is None:
        return None
    sections = re.findall(r"(?ms)^===Pronunciation===\s*(.*?)(?=^={2,3}[^=]|\Z)", english.group(1))
    return sections[0] if len(sections) == 1 else None


@dataclass(frozen=True)
class BranchNode:
    level: int
    line: int
    parent: int | None
    phonetics: tuple[str, ...]
    accents: tuple[str, ...]
    audio: tuple[str, ...]


def template_parts(content: str, name: str) -> list[list[str]]:
    return [
        [part.strip() for part in match.group(1).split("|")]
        for match in re.finditer(r"\{\{" + name + r"\|([^{}]+)\}\}", content, re.IGNORECASE)
    ]


def template_accents(parts: list[str]) -> tuple[str, ...]:
    for part in parts:
        if part.startswith("a="):
            return tuple(item.strip() for item in part[2:].split(",") if item.strip())
    return ()


def parse_branch_nodes(section: str) -> list[BranchNode]:
    nodes: list[BranchNode] = []
    stack: list[int] = []
    for line_number, line in enumerate(section.splitlines(), start=1):
        match = re.match(r"^(\*+)\s*(.*)$", line)
        if match is None:
            continue
        level = len(match.group(1))
        content = match.group(2)
        while len(stack) >= level:
            stack.pop()
        parent = stack[-1] if stack else None
        phonetics = []
        accents = []
        audio_titles = []
        for parts in template_parts(content, "IPA"):
            if len(parts) < 2 or parts[0] != "en":
                continue
            phonetics.extend(
                value for value in parts[1:]
                if value.startswith(("/", "["))
            )
            accents.extend(template_accents(parts[1:]))
        for parts in template_parts(content, "(?:audio|audiofile)"):
            if len(parts) >= 2 and parts[0] == "en" and parts[1]:
                audio_titles.append(parts[1].removeprefix("File:"))
                accents.extend(template_accents(parts[1:]))
        for parts in template_parts(content, "a"):
            if len(parts) >= 2 and parts[0] == "en" and parts[1]:
                accents.append(parts[1])
        nodes.append(BranchNode(
            level, line_number, parent, tuple(phonetics),
            tuple(dict.fromkeys(accents)), tuple(audio_titles),
        ))
        stack.append(len(nodes) - 1)
    return nodes


def inherited_accents(nodes: list[BranchNode], index: int) -> tuple[str, ...]:
    current: int | None = index
    while current is not None:
        if nodes[current].accents:
            return nodes[current].accents
        current = nodes[current].parent
    return ()


def parse_branch_associations(wikitext: str) -> list[dict[str, Any]]:
    section = pronunciation_section(wikitext)
    if section is None:
        return []
    nodes = parse_branch_nodes(section)
    associations = []
    for audio_index, audio_node in enumerate(nodes):
        for title in audio_node.audio:
            ipa_index: int | None = audio_index
            while ipa_index is not None and not nodes[ipa_index].phonetics:
                ipa_index = nodes[ipa_index].parent
            relation = "ancestor"
            if ipa_index is None:
                audio_accents = inherited_accents(nodes, audio_index)
                matches = [
                    index for index, node in enumerate(nodes)
                    if node.phonetics and set(audio_accents).intersection(inherited_accents(nodes, index))
                ]
                if len(matches) == 1:
                    ipa_index = matches[0]
                    relation = "accent"
            association = {
                "audio": title,
                "phonetics": list(nodes[ipa_index].phonetics) if ipa_index is not None else [],
                "relation": relation if ipa_index is not None else "unresolved",
                "ipaLine": nodes[ipa_index].line if ipa_index is not None else 0,
                "audioLine": audio_node.line,
                "ipaAccents": list(inherited_accents(nodes, ipa_index)) if ipa_index is not None else [],
                "audioAccents": list(inherited_accents(nodes, audio_index)),
            }
            associations.append(association)
    return associations


def parse_associations(wikitext: str) -> tuple[list[str], list[str]]:
    section = pronunciation_section(wikitext)
    if section is None:
        return [], []
    nodes = parse_branch_nodes(section)
    ipa_values = [ipa for node in nodes for ipa in node.phonetics]
    audio = [title for node in nodes for title in node.audio]
    return list(dict.fromkeys(ipa_values)), list(dict.fromkeys(audio))


def wiktionary_record(client: CachedClient, word: str) -> tuple[dict[str, Any], CachedJson]:
    response = client.get_json(api_url("en.wiktionary.org", {
        "action": "query", "prop": "revisions", "rvprop": "ids|content|timestamp",
        "rvslots": "main", "titles": word, "format": "json", "formatversion": "2",
    }))
    try:
        page = response.value["query"]["pages"][0]
        revision = page["revisions"][0]
        content = revision["slots"]["main"]["content"]
        revid = int(revision["revid"])
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise CollectionError(f"Wiktionary 响应结构不完整：{word}") from error
    ipa, audio = parse_associations(content)
    return {
        "word": word,
        "pageUrl": f"https://en.wiktionary.org/wiki/{word}",
        "revisionId": revid,
        "revisionTimestamp": revision.get("timestamp"),
        "sourcePhonetics": ipa,
        "audioTitles": audio,
        "branches": parse_branch_associations(content),
        "rawResponseSha256": response.sha256,
        "rawResponse": response.cache_ref,
    }, response


def commons_asset(client: CachedClient, title: str) -> tuple[dict[str, Any], CachedJson]:
    response = client.get_json(api_url("commons.wikimedia.org", {
        "action": "query", "titles": f"File:{title}", "prop": "videoinfo|revisions",
        "viprop": "url|size|mime|sha1|extmetadata|derivatives", "rvprop": "ids",
        "format": "json", "formatversion": "2",
    }))
    try:
        page = response.value["query"]["pages"][0]
        info = page["videoinfo"][0]
        revision_id = int(page["revisions"][0]["revid"])
        metadata = info["extmetadata"]
        artist = clean_html(metadata["Artist"]["value"])
        short_name = clean_html(metadata["LicenseShortName"]["value"])
        license_url = clean_html(metadata.get("LicenseUrl", {}).get("value", ""))
        if license_url.startswith("//"):
            license_url = "https:" + license_url
        if license_url.startswith("http://creativecommons.org/"):
            license_url = "https://" + license_url.removeprefix("http://")
        if not artist or "No machine-readable author provided" in artist:
            raise AssetRejected("缺少明确作者归因")
        normalized_license = short_name.lower().replace("  ", " ")
        if normalized_license not in LICENSES:
            raise AssetRejected(f"许可不在白名单：{short_name or '缺失'}")
        spdx, license_name = LICENSES[normalized_license]
        page_url = info["descriptionurl"]
        if spdx == "Public-Domain":
            license_url = page_url
        elif spdx == "CC0-1.0" and not license_url:
            license_url = "https://creativecommons.org/publicdomain/zero/1.0/"
        if not license_url:
            raise AssetRejected("缺少许可链接")
        duration = float(info.get("duration", 0))
        if not 0 < duration <= MAX_DURATION:
            raise AssetRejected(f"录音时长不合格：{duration}")
        digest = info["sha1"]
        candidates = [{"url": info["url"], "mime": info["mime"], "durationSeconds": duration}]
        for derivative in info.get("derivatives", []):
            if derivative.get("transcodekey") and derivative.get("src") and derivative.get("type"):
                candidates.append({
                    "url": derivative["src"], "mime": derivative["type"], "durationSeconds": duration,
                })
        media = []
        for candidate in candidates:
            head = client.head_media(candidate["url"])
            if head.mime != candidate["mime"].lower():
                raise AssetRejected(f"元数据与 HEAD MIME 不一致：{candidate['mime']} != {head.mime}")
            media.append({**candidate, "url": head.final_url, "mime": head.mime, "bytes": head.bytes})
        if not media:
            raise AssetRejected("没有实际存在且合格的媒体表示")
        asset = {
            "assetId": f"commons-{digest}", "pageUrl": page_url, "revisionId": revision_id,
            "digest": digest, "metadataSha256": response.sha256, "author": artist,
            "license": {"spdx": spdx, "name": license_name, "url": license_url},
            "changes": "原始录音未修改；MP3 等候选仅为 Wikimedia 官方转码",
            "media": media,
        }
        return asset, response
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise CollectionError(f"Commons 响应结构不完整：{title}") from error


def fingerprint(phonetic: str) -> str:
    value = 0xCBF29CE484222325
    normalized = unicodedata.normalize("NFC", phonetic.strip())
    raw = normalized.encode("utf-16-be")
    for index in range(0, len(raw), 2):
        value ^= int.from_bytes(raw[index:index + 2], "big")
        value = (value * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{value:016x}"


def reviewed_branch(record: dict[str, Any], review: dict[str, str]) -> dict[str, Any]:
    branch = next((
        item for item in record["branches"]
        if item["audio"] == review["audio"] and review["sourcePhonetic"] in item["phonetics"]
    ), None)
    if branch is None or review["currentPhonetic"] != record["currentPhonetic"]:
        raise CollectionError("已核验 IPA—口音—录音分支与真实数据不符；停止而非交叉配对")
    return branch


def collect(client: CachedClient) -> tuple[dict[str, Any], dict[str, Any]]:
    current = lookup_current_phonetics()
    entries = []
    assets: dict[str, Any] = {}
    coverage = []
    for word in WORDS:
        record, source = wiktionary_record(client, word)
        record["currentPhonetic"] = current.get(word)
        record["accepted"] = False
        review = REVIEWED_READINGS.get(word)
        if not record["currentPhonetic"]:
            record["gap"] = "current-phonetic-missing"
        elif review is None:
            record["gap"] = (
                "scope-unknown-or-audio-missing"
                if not record["sourcePhonetics"] or not record["audioTitles"]
                else "reading-review-missing"
            )
        else:
            title = review["audio"]
            source_phonetic = review["sourcePhonetic"]
            branch = reviewed_branch(record, review)
            try:
                asset, metadata = commons_asset(client, title)
                record["commons"] = {
                    "pageUrl": asset["pageUrl"], "revisionId": asset["revisionId"],
                    "metadataSha256": metadata.sha256, "rawResponse": metadata.cache_ref,
                    "license": asset["license"], "author": asset["author"],
                    "media": asset["media"],
                }
            except AssetRejected as error:
                record["gap"] = f"license-or-media: {error}"
            else:
                entry = {
                    "word": word, "language": "en", "phonetic": record["currentPhonetic"],
                    "phoneticFingerprint": fingerprint(record["currentPhonetic"]),
                    "accent": review["accent"], "scope": {"kind": "legacy-unique", "verified": True},
                    "assetId": asset["assetId"],
                    "evidence": {
                        "wiktionaryPageUrl": record["pageUrl"],
                        "wiktionaryRevisionId": record["revisionId"],
                        "sourcePhonetic": source_phonetic,
                        "responseSha256": source.sha256,
                        "association": "wiktionary-pronunciation-section",
                        "branch": {
                            "relation": branch["relation"],
                            "ipaLine": branch["ipaLine"], "audioLine": branch["audioLine"],
                            "ipaAccents": branch["ipaAccents"], "audioAccents": branch["audioAccents"],
                        },
                        "verifiedAt": review["verifiedAt"], "verifiedBy": review["verifiedBy"],
                        "reviewNote": review["reviewNote"],
                    },
                }
                entries.append(entry)
                assets[asset["assetId"]] = asset
                record["accepted"] = True
                record["gap"] = None
                record["reviewNote"] = review["reviewNote"]
        coverage.append(record)
    timestamps = [r["revisionTimestamp"] for r in coverage if r["revisionTimestamp"]]
    generated_at = max(timestamps) if timestamps else datetime.now(timezone.utc).isoformat()
    manifest = {
        "manifestVersion": "pronunciation-audio/1", "generatedAt": generated_at,
        "entries": entries, "assets": list(assets.values()),
    }
    report = {
        "schema": "pronunciation-audio-coverage/1", "frozenWords": list(WORDS),
        "acceptedEntries": len(entries), "syntheticFixturesCounted": 0,
        "requestCount": client.requests, "records": coverage,
    }
    return manifest, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--inspect", action="store_true", help="只打印采集/许可结果，不写正式 sidecar")
    parser.add_argument("--cache-dir", type=Path, default=CACHE_PATH)
    parser.add_argument("--max-requests", type=int, default=100)
    args = parser.parse_args()
    client = CachedClient(args.cache_dir, max_requests=args.max_requests)
    manifest, report = collect(client)
    if args.inspect:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    if len(manifest["entries"]) < 3:
        raise CollectionError("真实合格映射少于 3 个；正式 manifest 保持原样")
    outputs = ((MANIFEST_PATH, json_bytes(manifest)), (COVERAGE_PATH, json_bytes(report)))
    if args.check:
        mismatches = [str(path) for path, data in outputs if not path.exists() or path.read_bytes() != data]
        if mismatches:
            raise CollectionError("正式产物不是最新：" + ", ".join(mismatches))
        return
    for path, data in outputs:
        atomic_write(path, data)
    print(f"已生成 {len(manifest['entries'])} 个真实映射；20 词覆盖报告：{COVERAGE_PATH}")


if __name__ == "__main__":
    main()
