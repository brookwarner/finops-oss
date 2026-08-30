#!/usr/bin/env python3
"""Generate FinOps app icons (the two-tone "pill" mark) as opaque, full-bleed,
maskable-safe PNGs.

Why full-bleed + maskable-safe: Android WebAPK adaptive icons require an icon
whose `purpose` includes `maskable`. A maskable icon must paint to all four
edges (no transparent corners) because the launcher crops it to the device's
mask shape (circle/squircle/…); the meaningful content must sit inside the
central "safe zone" (~80% diameter) so it survives the crop. We emit a single
image per size used for BOTH `any` and `maskable` (matching the setup of our
sibling app that installs cleanly), so the manifest never has to juggle a
separate maskable file and Chrome always has a valid maskable candidate.

Run: python3 scripts/gen_icons.py   (requires Pillow)
Outputs: public/icon-192.png, public/icon-512.png  (+ favicon-16/32 unchanged)
"""
from PIL import Image, ImageDraw

BG = (15, 23, 20, 255)        # #0F1714 brand tile
GREEN = (52, 190, 124, 255)   # #34BE7C
ORANGE = (224, 138, 87, 255)  # #E08A57

# Pill geometry as a fraction of canvas: width 66% keeps the rounded ends well
# inside the maskable safe circle (a horizontal capsule's extreme points are its
# ends, at ±width/2 from centre; 0.66 < 0.80 safe-zone diameter). Aspect ~3.25:1.
PILL_W = 0.66
PILL_ASPECT = 3.25


def render(size: int) -> Image.Image:
    # Supersample 4x then downscale for clean antialiased edges.
    ss = size * 4
    img = Image.new("RGBA", (ss, ss), BG)
    d = ImageDraw.Draw(img)

    w = PILL_W * ss
    h = w / PILL_ASPECT
    cx = cy = ss / 2
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = cy - h / 2, cy + h / 2
    r = h / 2  # fully rounded ends (capsule)

    # Left half (green): round the left end only. corners = (TL, TR, BR, BL).
    d.rounded_rectangle((x0, y0, cx, y1), radius=r, fill=GREEN,
                        corners=(True, False, False, True))
    # Right half (orange): round the right end only.
    d.rounded_rectangle((cx, y0, x1, y1), radius=r, fill=ORANGE,
                        corners=(False, True, True, False))

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    for size in (192, 512):
        out = f"public/icon-{size}.png"
        render(size).save(out, optimize=True)
        print("wrote", out)


if __name__ == "__main__":
    main()
