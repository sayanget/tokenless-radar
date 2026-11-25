"""Screenshots of the built page (out/dashboard/index.html) in headless Chrome over file://.

usage: python3 tools/shoot.py <out_dir> <shots_dir> [--png]
Writes 1-board, 2-detail and 3-filtered at 1440x1000 (device scale 1), as JPEG tuned to land at
300-350 KB each (or PNG with --png), and prints any page error or console error it sees.
"""
import io
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

VIEWS = [
    ("1-board", ""),
    ("2-detail", "#open=steakhouse-financial"),
    ("3-filtered", "#tier=early&sort=farm&dir=-1"),
]


def encode(png_bytes, target_lo=300_000, target_hi=350_000):
    """Re-encode a PNG screenshot as JPEG, picking the quality whose size lands in the target band."""
    from PIL import Image

    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    best = None
    for q in range(95, 59, -1):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q, optimize=True, progressive=True, subsampling=0)
        size = buf.tell()
        if size <= target_hi:
            best = buf.getvalue()
            if size >= target_lo or q < 92:
                break
    return best


def main():
    out_dir = Path(sys.argv[1]).resolve()
    shots = Path(sys.argv[2]).resolve()
    as_png = "--png" in sys.argv
    shots.mkdir(parents=True, exist_ok=True)
    page_url = (out_dir / "dashboard" / "index.html").as_uri()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--force-color-profile=srgb"])
        for name, frag in VIEWS:
            ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(page_url + frag)
            page.wait_for_selector("#app[aria-busy='false']")
            page.wait_for_timeout(400)
            png = page.screenshot(type="png")
            if as_png:
                (shots / f"{name}.png").write_bytes(png)
            else:
                (shots / f"{name}.jpg").write_bytes(encode(png))
            print(name, "errors:", errors or "none")
            ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
