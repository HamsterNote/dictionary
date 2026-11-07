from __future__ import annotations

import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import generate_pronunciation_audio as audio


class FakeResponse:
    def __init__(self, payload: bytes, url: str = "https://en.wiktionary.org/w/api.php", headers=None):
        self.payload = payload
        self.url = url
        self.headers = headers or {}
        self.status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self, _limit: int) -> bytes:
        return self.payload

    def geturl(self) -> str:
        return self.url


class CollectorTests(unittest.TestCase):
    def test_association_requires_one_pronunciation_section(self):
        content = "==English==\n===Pronunciation===\n* {{IPA|en|/kæt/}}\n* {{audio|en|En-uk-cat.ogg}}\n===Noun===\n==French==\n{{IPA|fr|/ka/}}"
        self.assertEqual(audio.parse_associations(content), (["/kæt/"], ["En-uk-cat.ogg"]))
        ambiguous = content.replace("{{audio|en|En-uk-cat.ogg}}", "{{audio|en|a.ogg}} {{audio|en|b.ogg}}")
        self.assertEqual(audio.parse_associations(ambiguous)[1], ["a.ogg", "b.ogg"])

    def test_same_section_branches_cannot_cross_pair_ipa_and_audio(self):
        content = """==English==
===Pronunciation===
* {{IPA|en|/ˈæpəl/|a=RP,GA}}
** {{audio|en|En-us-apple.ogg|a=GA}}
* {{IPA|en|/ˈapəl/|a=SSB}}
** {{audio|en|En-uk-apple.ogg|a=SSB}}
===Noun===
"""
        branches = audio.parse_branch_associations(content)
        uk = next(item for item in branches if item["audio"] == "En-uk-apple.ogg")
        self.assertEqual(uk["phonetics"], ["/ˈapəl/"])
        self.assertEqual(uk["relation"], "ancestor")
        self.assertEqual(uk["ipaAccents"], ["SSB"])
        record = {"branches": branches, "currentPhonetic": "'æpl"}
        wrong_review = {
            "audio": "En-uk-apple.ogg", "sourcePhonetic": "/ˈæpəl/", "currentPhonetic": "'æpl",
        }
        with self.assertRaisesRegex(audio.CollectionError, "停止而非交叉配对"):
            audio.reviewed_branch(record, wrong_review)
        valid_review = {
            "audio": "En-us-apple.ogg", "sourcePhonetic": "/ˈæpəl/", "currentPhonetic": "'æpl",
        }
        self.assertEqual(audio.reviewed_branch(record, valid_review)["relation"], "ancestor")

    def test_cache_serial_rate_limit_and_request_budget(self):
        calls = []
        sleeps = []

        def transport(request, timeout):
            calls.append(request.full_url)
            return FakeResponse(b'{"query": {}}')

        with tempfile.TemporaryDirectory() as directory:
            client = audio.CachedClient(
                Path(directory), max_requests=2, min_interval=1,
                transport=transport, sleep=sleeps.append, clock=lambda: 0,
            )
            url = audio.api_url("en.wiktionary.org", {"titles": "cat"})
            client.get_json(url)
            client.get_json(url)
            self.assertEqual(len(calls), 1)
            client.get_json(audio.api_url("en.wiktionary.org", {"titles": "dog"}))
            self.assertEqual(sleeps, [1])
            with self.assertRaisesRegex(audio.CollectionError, "请求限额"):
                client.get_json(audio.api_url("en.wiktionary.org", {"titles": "bird"}))

    def test_retry_after_and_truncated_response_leave_no_cache(self):
        retry_url = audio.api_url("en.wiktionary.org", {"titles": "retry"})

        def limited(_request, timeout):
            raise HTTPError(retry_url, 429, "limited", {"Retry-After": "12"}, io.BytesIO())

        with tempfile.TemporaryDirectory() as directory:
            client = audio.CachedClient(Path(directory), transport=limited)
            with self.assertRaises(audio.RetryAfterError) as caught:
                client.get_json(retry_url)
            self.assertEqual(caught.exception.retry_after, "12")
            self.assertEqual(list(Path(directory).iterdir()), [])

            truncated = audio.CachedClient(
                Path(directory), transport=lambda _request, timeout: FakeResponse(b"x" * (4 * 1024 * 1024 + 1)),
            )
            with self.assertRaisesRegex(audio.CollectionError, "响应过大或截断"):
                truncated.get_json(audio.api_url("en.wiktionary.org", {"titles": "large"}))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_failure_does_not_replace_formal_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "manifest.json"
            manifest.write_bytes(b"original-manifest")
            with (
                patch.object(audio, "MANIFEST_PATH", manifest),
                patch.object(audio, "collect", side_effect=audio.CollectionError("network failed")),
                patch("sys.argv", ["generate_pronunciation_audio.py"]),
            ):
                with self.assertRaises(audio.CollectionError):
                    audio.main()
            self.assertEqual(manifest.read_bytes(), b"original-manifest")

    def test_commercial_or_non_https_endpoints_are_rejected(self):
        client = audio.CachedClient(Path("unused"))
        for url in ("https://dict.youdao.com/audio", "http://en.wiktionary.org/w/api.php"):
            with self.subTest(url=url), self.assertRaises(audio.CollectionError):
                client.get_json(url)

    def test_head_validates_redirect_host_mime_and_size(self):
        url = "https://upload.wikimedia.org/audio.mp3"
        for headers in (
            {"Content-Type": "text/html", "Content-Length": "100"},
            {"Content-Type": "audio/mpeg", "Content-Length": str(audio.MAX_BYTES + 1)},
        ):
            with self.subTest(headers=headers), tempfile.TemporaryDirectory() as directory:
                client = audio.CachedClient(
                    Path(directory), transport=lambda _request, timeout: FakeResponse(b"", url, headers),
                )
                with self.assertRaises(audio.CollectionError):
                    client.head_media(url)
        with tempfile.TemporaryDirectory() as directory:
            redirected = "https://example.com/audio.mp3"
            client = audio.CachedClient(
                Path(directory),
                transport=lambda _request, timeout: FakeResponse(
                    b"", redirected, {"Content-Type": "audio/mpeg", "Content-Length": "100"},
                ),
            )
            with self.assertRaises(audio.CollectionError):
                client.head_media(url)

    def test_per_file_license_attribution_and_real_derivatives(self):
        original = "https://upload.wikimedia.org/original.ogg"
        derivative = "https://upload.wikimedia.org/transcoded/original.mp3"

        class FakeClient:
            def __init__(self, license_name="CC BY 4.0", artist="Example Author", duration=1):
                info = {
                    "url": original, "descriptionurl": "https://commons.wikimedia.org/wiki/File:Original.ogg",
                    "sha1": "0123456789abcdef0123456789abcdef01234567", "mime": "application/ogg",
                    "duration": duration,
                    "extmetadata": {
                        "Artist": {"value": artist},
                        "LicenseShortName": {"value": license_name},
                        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by/4.0/"},
                    },
                    "derivatives": [{"src": derivative, "type": "audio/mpeg", "transcodekey": "mp3"}],
                }
                self.response = audio.CachedJson({
                    "query": {"pages": [{"videoinfo": [info], "revisions": [{"revid": 123}]}]},
                }, "a" * 64, "fixture.json")

            def get_json(self, _url):
                return self.response

            def head_media(self, url):
                return audio.MediaHead(url, "audio/mpeg" if url == derivative else "application/ogg", 100, "head.json")

        asset, _ = audio.commons_asset(FakeClient(), "Original.ogg")
        self.assertEqual(asset["license"]["spdx"], "CC-BY-4.0")
        self.assertEqual([item["url"] for item in asset["media"]], [original, derivative])
        for kwargs in ({"license_name": "CC BY-NC 4.0"}, {"artist": ""}, {"duration": 31}):
            with self.subTest(kwargs=kwargs), self.assertRaises(audio.AssetRejected):
                audio.commons_asset(FakeClient(**kwargs), "Original.ogg")

        client = FakeClient()
        client.head_media = lambda url: (_ for _ in ()).throw(audio.AssetRejected("假 mp3 地址")) if url == derivative else audio.MediaHead(url, "application/ogg", 100, "head.json")
        with self.assertRaises(audio.AssetRejected):
            audio.commons_asset(client, "Original.ogg")

        mismatch = FakeClient()
        mismatch.head_media = lambda url: audio.MediaHead(url, "audio/ogg", 100, "head.json")
        with self.assertRaisesRegex(audio.AssetRejected, "MIME 不一致"):
            audio.commons_asset(mismatch, "Original.ogg")


if __name__ == "__main__":
    unittest.main()
