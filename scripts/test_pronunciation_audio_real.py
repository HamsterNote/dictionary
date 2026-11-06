"""真实 Commons MP3 的 Chromium 获取、解码、播放事件与同会话离线复播验收。"""
from __future__ import annotations

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
    base = f"http://127.0.0.1:{port}/scripts/fixtures/pronunciation-audio-real.html"
    with tempfile.TemporaryFile() as log:
        server = subprocess.Popen(
            ["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
            cwd=ROOT, stdout=log, stderr=log,
        )
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(base, timeout=1) as response:
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
                    media_responses = []
                    errors = []
                    page.on("response", lambda response: media_responses.append((response.url, response.status)) if response.url.startswith("https://upload.wikimedia.org/") else None)
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    for index, word in enumerate(("hello", "apple", "book")):
                        page.goto(f"{base}?word={word}")
                        page.get_by_role("button", name=f"朗读 {word}", exact=True).click()
                        page.get_by_text("正在播放", exact=True).wait_for(timeout=15000)
                        page.get_by_role("button", name=f"朗读 {word}", exact=True).wait_for(timeout=15000)
                        if index == 0:
                            requests_before = len(media_responses)
                            context.set_offline(True)
                            page.get_by_role("button", name=f"朗读 {word}", exact=True).click()
                            page.get_by_text("正在播放", exact=True).wait_for(timeout=5000)
                            page.get_by_role("button", name=f"朗读 {word}", exact=True).wait_for(timeout=5000)
                            assert len(media_responses) == requests_before
                            context.set_offline(False)
                    assert len(media_responses) == 3, media_responses
                    assert all(status == 200 for _url, status in media_responses)
                    assert not errors, errors
                finally:
                    browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)
    print("test_pronunciation_audio_real: OK (hello/apple/book MP3 fetch + decode + play/ended; cached offline replay)")
    print("人工听感、iOS/Android 真机不在此自动化结果内")


if __name__ == "__main__":
    main()
