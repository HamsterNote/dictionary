"""Optional browser acceptance test using an existing Playwright installation; only localhost is allowed."""
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
# 归档 change 只读：截图写到稳定输出目录，可用环境变量覆盖。
SCREENSHOT_DIRECTORY = Path(
    os.environ.get("PRONUNCIATION_UI_SCREENSHOT_DIR", str(ROOT / "reports/pronunciation-ui"))
)


def main() -> None:
    SCREENSHOT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    url = f"http://127.0.0.1:{port}/scripts/fixtures/pronunciation-overlay.html"
    with tempfile.TemporaryFile() as log:
        server = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", str(port), "--strictPort"], cwd=ROOT, stdout=log, stderr=log)
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
                    page = browser.new_page(viewport={"width": 1100, "height": 900})
                    page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(f"http://127.0.0.1:{port}/") else route.abort())
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(url)
                    page.get_by_role("button", name="纠错该读音").first.wait_for()
                    assert page.locator(".dictionary-pronunciations section").count() == 4
                    assert page.get_by_text("未注明口音", exact=True).first.is_visible()
                    assert page.get_by_text("待复核", exact=True).first.is_visible()
                    assert page.get_by_text("复核时间未知", exact=True).first.is_visible()
                    assert page.locator(".dictionary-pronunciations").inner_text().count("[x]") == 2
                    page.screenshot(path=str(SCREENSHOT_DIRECTORY / "ham37-ui-desktop.png"), full_page=True)
                    page.get_by_role("checkbox", name="模拟持久化失败").check()
                    page.get_by_role("button", name="纠错该读音").first.click()
                    page.get_by_role("textbox", name="音标").fill("[test]")
                    page.get_by_role("button", name="保存纠错", exact=True).click()
                    page.get_by_role("alert").filter(has_text="synthetic storage failure").wait_for()
                    assert page.get_by_test_id("saved").inner_text() == "[]"
                    page.get_by_role("button", name="取消", exact=True).click()
                    page.get_by_role("checkbox", name="模拟持久化失败").uncheck()
                    page.get_by_role("button", name="纠错该读音").nth(2).click()
                    page.get_by_role("textbox", name="音标").fill("[test]")
                    page.get_by_role("button", name="保存纠错", exact=True).click()
                    page.get_by_role("dialog").wait_for(state="hidden")
                    assert '"role":{"kind":"known","values":["past"]}' in page.get_by_test_id("saved").inner_text()
                    page.get_by_role("button", name="确认核验").first.click()
                    assert page.get_by_test_id("verified").inner_text().startswith("ent_")
                    page.get_by_role("button", name="朗读 syntheticfixture").click()
                    assert page.get_by_test_id("spoken").inner_text() == "syntheticfixture"
                    page.set_viewport_size({"width": 360, "height": 800})
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                    page.screenshot(path=str(SCREENSHOT_DIRECTORY / "ham37-ui-mobile.png"), full_page=True)
                    page.goto(url + "?readonly")
                    page.locator(".dictionary-pronunciations section").first.wait_for()
                    assert page.get_by_role("button", name="纠错该读音").count() == 0
                    page.goto(url + "?blocked")
                    page.get_by_text("新读法暂未启用", exact=False).wait_for()
                    assert page.locator(".dictionary-pronunciations").count() == 0
                    assert page.get_by_text("英：/legacy/", exact=False).is_visible()
                    page.get_by_text("候选对照", exact=True).click()
                    assert page.get_by_text("synthetic candidate only", exact=True).is_visible()
                    assert not errors, errors
                finally:
                    browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)
    print("test_pronunciation_ui: OK (desktop/mobile, save failure/success, roles, verification, v1 guard, word-only audio)")


if __name__ == "__main__":
    main()
