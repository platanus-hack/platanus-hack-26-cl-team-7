"""Static assets of the stand-in demo shop, built in memory so the site needs no files."""

import struct
import zlib

CSS = """body{font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem}
nav a{margin-right:.5rem}form{display:grid;gap:.5rem;max-width:20rem}.price{font-weight:bold}
"""
JS = 'document.addEventListener("DOMContentLoaded", () => { document.body.dataset.ready = "1"; });'
SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    '<circle cx="16" cy="16" r="14" fill="#f5a623"/></svg>'
)


def png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(kind + data)
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)

    row = b"\x00" + bytes(rgb) * width
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    pixels = zlib.compress(row * height)
    return (
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", pixels) + chunk(b"IEND", b"")
    )


def ico(image: bytes) -> bytes:
    entry = struct.pack("<BBBBHHII", 16, 16, 0, 0, 1, 32, len(image), 22)
    return struct.pack("<HHH", 0, 1, 1) + entry + image


ASSETS = {
    "/static/css/site.css": ("text/css; charset=utf-8", CSS.encode()),
    "/static/js/app.js": ("text/javascript; charset=utf-8", JS.encode()),
    "/static/img/logo.svg": ("image/svg+xml", SVG.encode()),
    "/static/img/hero.png": ("image/png", png(64, 32, (245, 166, 35))),
}
FAVICON = ico(png(16, 16, (245, 166, 35)))
ROBOTS = b"User-agent: *\nAllow: /\n"
