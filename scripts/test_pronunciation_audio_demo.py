"""对正在运行的 dictionary demo 验证真人录音入口；不启动或重启服务。"""
from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "reports/pronunciation-audio"


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        executables = sorted((Path.home() / ".cache/selenium/chrome/linux64").glob("*/chrome"))
        executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE") or (str(executables[-1]) if executables else None)
        browser = playwright.chromium.launch(executable_path=executable, headless=True, args=["--no-sandbox"])
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(os.environ.get("DEMO_URL", "http://127.0.0.1:9489/"))
            search = page.get_by_role("combobox", name="搜索英文单词", exact=True)
            for word in ("hello", "cat", "dog"):
                search.fill(word)
                search.press("Enter")
                button = page.get_by_role("button", name=f"朗读 {word}", exact=True)
                button.wait_for()
                assert button.is_enabled(), f"{word} 应可播放"
                button.click()
                page.get_by_text("正在播放", exact=True).wait_for(timeout=15000)
                button.wait_for()
                page.get_by_text("正在播放", exact=True).wait_for(state="hidden", timeout=15000)
                if word == "hello":
                    page.screenshot(path=str(OUTPUT / "demo-hello.png"), clip={"x": 680, "y": 0, "width": 620, "height": 460})
            for word in ("apple", "book"):
                search.fill(word)
                search.press("Enter")
                button = page.get_by_role("button", name=f"朗读 {word}", exact=True)
                button.wait_for()
                assert button.is_disabled(), f"{word} 应降级"
                assert page.get_by_text("暂无读音", exact=True).is_visible()
                if word == "apple":
                    page.screenshot(path=str(OUTPUT / "demo-apple.png"), clip={"x": 680, "y": 0, "width": 620, "height": 460})
            assert page.get_by_text("改用 Kokoro AI 合成朗读", exact=True).is_visible()
            assert page.get_by_text("默认播放 Commons 真人录音", exact=False).is_visible()
            assert not errors, errors
        finally:
            browser.close()
    print("test_pronunciation_audio_demo: OK (real hello/cat/dog playback; apple/book unavailable; Kokoro label)")


if __name__ == "__main__":
    main()
