"""使用真实 Chromium 验证发音共享组件；仅访问本机 fixture，不请求第三方。"""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    url = f"http://127.0.0.1:{port}/scripts/fixtures/pronunciation-audio.html"
    with tempfile.TemporaryFile() as log:
        server = subprocess.Popen(
            ["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
            cwd=ROOT, stdout=log, stderr=log,
        )
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(url, timeout=1) as response:
                        if response.status == 200:
                            break
                except OSError:
                    time.sleep(0.1)
            else:
                raise AssertionError("fixture server did not become ready")
            with sync_playwright() as playwright:
                executables = sorted((Path.home() / ".cache/selenium/chrome/linux64").glob("*/chrome"))
                executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE") or (str(executables[-1]) if executables else None)
                browser = playwright.chromium.launch(executable_path=executable, headless=True, args=["--no-sandbox"])
                try:
                    context = browser.new_context()
                    page = context.new_page()
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(url)
                    play = page.get_by_role("button", name="朗读 hello", exact=True)
                    play.wait_for()
                    assert "hә'lәu" in page.locator(".dictionary-popover__phonetic").inner_text()
                    page.get_by_text("音频来源", exact=True).click()
                    assert page.get_by_text("Association Shtooka, Judith Franck", exact=False).is_visible()
                    context.set_offline(True)
                    assert page.get_by_text("Creative Commons Attribution", exact=False).first.is_visible()
                    context.set_offline(False)

                    play.focus()
                    page.keyboard.press("Enter")
                    assert page.evaluate("window.__audioFixture.calls[0].word") == "hello"
                    assert page.get_by_text("正在播放", exact=True).is_visible()
                    assert page.get_by_text("hello cat", exact=False).is_visible()
                    page.get_by_role("button", name="结束播放", exact=True).click()
                    stops = page.evaluate("window.__audioFixture.stopCount")
                    page.get_by_role("button", name="cat", exact=True).click()
                    cat_play = page.get_by_role("button", name="朗读 cat", exact=True)
                    cat_play.wait_for()
                    assert page.evaluate("window.__audioFixture.stopCount") > stops
                    cat_play.click()
                    assert page.evaluate("window.__audioFixture.calls.at(-1).word") == "cat"

                    page.get_by_role("button", name="纠错词条 cat", exact=True).click()
                    for _ in range(5):
                        page.get_by_role("button", name="删除前一个字符", exact=True).click()
                    page.get_by_role("button", name="插入 æ", exact=True).click()
                    page.get_by_role("button", name="保存纠错", exact=True).click()
                    assert page.get_by_text("暂无读音", exact=True).is_visible()
                    assert cat_play.is_disabled()
                    assert "æ" in page.locator(".dictionary-popover__phonetic").inner_text()
                    assert page.get_by_text("cat hello", exact=False).is_visible()
                    assert page.get_by_text("音频来源", exact=True).count() == 0

                    page.goto(url)
                    page.get_by_role("button", name="模拟词头纠错", exact=True).click()
                    assert page.get_by_role("heading", name="hello- edited", exact=True).is_visible()
                    assert page.get_by_text("暂无读音", exact=True).is_visible()
                    page.goto(url)
                    page.get_by_role("button", name="模拟释义纠错", exact=True).click()
                    enabled = page.get_by_role("button", name="朗读 hello", exact=True)
                    assert enabled.is_enabled()
                    enabled.click()
                    assert page.evaluate("window.__audioFixture.calls.at(-1).word") == "hello"

                    page.goto(url)
                    page.evaluate("window.__audioFixture.mode = 'loading'")
                    page.get_by_role("button", name="朗读 hello", exact=True).click()
                    assert page.get_by_text("正在准备读音", exact=True).is_visible()
                    page.get_by_role("button", name="结束播放", exact=True).click()
                    for mode, message in (("offline", "联网后可播放"), ("network", "无法播放读音，请点击重试")):
                        page.evaluate(f"window.__audioFixture.mode = '{mode}'")
                        button = page.get_by_role("button", name="朗读 hello", exact=True)
                        button.click()
                        assert page.get_by_text(message, exact=True).is_visible()
                        assert page.evaluate("(element) => document.activeElement === element", button.element_handle())
                    page.evaluate("window.__audioFixture.mode = 'success'")
                    page.get_by_role("button", name="朗读 hello", exact=True).click()
                    assert page.get_by_text("正在播放", exact=True).is_visible()

                    page.goto(url + "?mode=overlay")
                    overlay_play = page.get_by_role("button", name="朗读 hello", exact=True)
                    overlay_play.wait_for()
                    assert overlay_play.is_enabled()
                    assert page.evaluate("window.__audioFixture.resolves.at(-1).phonetic") == "/overlay/"
                    assert page.evaluate("window.__audioFixture.resolves.at(-1).entryId") == "ent_00000000-0000-4000-8000-000000000001"
                    assert page.evaluate("window.__audioFixture.resolves.at(-1).role") == "base"
                    assert page.evaluate("window.__audioFixture.resolves.at(-1).accent") == "uk"
                    overlay_play.click()
                    assert page.evaluate("window.__audioFixture.calls.at(-1).phonetic") == "/overlay/"
                    overlay_stops = page.evaluate("window.__audioFixture.stopCount")
                    calls_before = page.evaluate("window.__audioFixture.calls.length")
                    page.get_by_role("button", name="切换 overlay 读法", exact=True).click()
                    assert overlay_play.is_disabled()
                    assert page.get_by_text("暂无读音", exact=True).is_visible()
                    assert page.evaluate("window.__audioFixture.stopCount") > overlay_stops
                    assert page.evaluate("window.__audioFixture.calls.length") == calls_before
                    assert page.evaluate("window.__audioFixture.resolves.at(-1).phonetic") == "/overlay-changed/"

                    page.goto(url + "?mode=legacy")
                    page.get_by_role("button", name="朗读 hello", exact=True).click()
                    assert page.get_by_test_id("legacy-calls").inner_text() == '["hello"]'
                    assert page.get_by_text("音频来源", exact=True).count() == 0
                    page.goto(url + "?mode=dual")
                    assert page.get_by_role("button", name="朗读 hello", exact=True).count() == 1
                    page.get_by_role("button", name="朗读 hello", exact=True).click()
                    assert page.evaluate("window.__audioFixture.calls.length") == 1
                    assert page.get_by_test_id("legacy-calls").inner_text() == "[]"
                    # A valid recording wins; an unavailable corrected reading
                    # uses the registered callback without guessing another file.
                    page.get_by_role("button", name="模拟词头纠错", exact=True).click()
                    fallback = page.get_by_role("button", name="朗读 hello- edited", exact=True)
                    assert fallback.is_enabled()
                    fallback.click()
                    assert page.get_by_test_id("legacy-calls").inner_text() == '["hello- edited"]'
                    assert page.evaluate("window.__audioFixture.calls.length") == 1
                    page.goto(url + "?mode=none")
                    assert page.get_by_role("button", name="朗读 hello", exact=True).is_disabled()
                    assert page.get_by_text("暂无读音", exact=True).is_visible()
                    # Plain IPA stays unknown; explicit overlay metadata carries accent.
                    for mode, expected in (
                        ("accent-us", {"language": "en-US", "languageSource": "overlay-accent"}),
                        ("accent-uk", {"language": "en-GB", "languageSource": "overlay-accent"}),
                        ("accent-unknown", {"languageSource": "unknown"}),
                    ):
                        page.goto(url + "?mode=" + mode)
                        page.get_by_role("button", name="朗读 hello", exact=True).click()
                        page.wait_for_function("document.querySelector('[data-testid=pronounce-options]').textContent.length > 0")
                        assert json.loads(page.get_by_test_id("pronounce-options").inner_text()) == expected
                    assert not errors, errors
                finally:
                    browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)
    print("test_pronunciation_audio_ui: OK (correction/context/stop/legacy/a11y/offline attribution)")


if __name__ == "__main__":
    main()
