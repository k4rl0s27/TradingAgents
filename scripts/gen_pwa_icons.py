"""Generate simple placeholder PWA icons (solid tile + white glyph) without image deps.

Run from webapp/ui: python ../../scripts/gen_pwa_icons.py
Replace with a proper brand icon later — these only satisfy installability.
"""

import struct
import zlib
from pathlib import Path

BG = (9, 9, 11)      # near-black tile
FG = (245, 245, 245)  # off-white glyph


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def png(size: int, maskable: bool) -> bytes:
    """Solid tile with an ascending three-bar glyph; maskable gets a
    full-bleed background (no corner cut) and a tighter content inset."""
    rows = []
    cx = size / 2
    # simple ascending "chart" zigzag glyph made of rectangles
    bar_w = size / 6
    gap = size / 12
    base = int(size * 0.75)
    heights = [size * 0.18, size * 0.32, size * 0.5]
    # content inset: tighter (safer) on maskable tiles, roomier otherwise
    inset = int(size * 0.1 if maskable else size * 0.24)

    def px(x: int, y: int) -> tuple[int, int, int]:
        # rounded-corner tile: cut corners beyond radius
        r = size * 0.18
        if not maskable:
            dx = min(x, size - x)
            dy = min(y, size - y)
            if dx < r and dy < r and (r - dx) ** 2 + (r - dy) ** 2 > r * r:
                return (0, 0, 0, 0)
        for i, h in enumerate(heights):
            x0 = int(cx - (3 * bar_w + 2 * gap) / 2 + i * (bar_w + gap))
            if x0 + inset // 4 <= x < x0 + bar_w - inset // 4 and base - h <= y < base:
                return FG
        return BG

    for y in range(size):
        row = bytearray(b"\x00")
        for x in range(size):
            r, g, b, *a = px(x, y)
            row += bytes((r, g, b, a[0] if a else 255))
        rows.append(bytes(row))
    raw = b"".join(rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )


if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parent.parent  # scripts/ -> repo root
    out = repo_root / "webapp" / "ui" / "public" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    (out / "icon-192.png").write_bytes(png(192, False))
    (out / "icon-512.png").write_bytes(png(512, False))
    (out / "icon-maskable-512.png").write_bytes(png(512, True))
    print(f"wrote {len(list(out.iterdir()))} icons to {out}")
