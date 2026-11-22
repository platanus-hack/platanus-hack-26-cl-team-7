"""The shop's file folder (--files) and PLANTED FLAW 3, invoice download by path.

`/account?invoice=<name>` reads `invoices/<name>` without checking who asks, and the name may hold
`../` or start with `/`. The path is resolved as if the folder were the file system root, the
way a chroot would: `../../etc/passwd` reads `<files>/etc/passwd`. Nothing outside the folder is
ever opened: after resolving, the real path must still be inside the folder and be a regular
file. Invoices are rendered from the instance's own database, so each lane shows its own data.
"""

from __future__ import annotations

import os
import posixpath
import re
from pathlib import Path

from demo import store
from demo.web import Shop

INVOICE_DIR = "invoices"
MAX_FILE_BYTES = 256 * 1024
_INVOICE = re.compile(rf"/{INVOICE_DIR}/(\d{{1,9}})\.txt")

UNIX_USERS = """root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
bin:x:2:2:bin:/bin:/usr/sbin/nologin
sys:x:3:3:sys:/dev:/usr/sbin/nologin
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
shop:x:1000:1000:FreshJuice shop:/srv/shop:/bin/sh
"""
OS_RELEASE = """PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
VERSION_ID="12"
ID=debian
"""
STATIC_FILES = {
    "docs/returns.txt": "Returns: unopened bottles within 14 days, with your invoice number.\n",
    "docs/shipping.txt": "Shipping: 24 h in Santiago, 48 to 72 h to the regions. Free over $30.\n",
    "etc/passwd": UNIX_USERS,
    "etc/group": "root:x:0:\nwww-data:x:33:\nshop:x:1000:\n",
    "etc/hostname": "shop-web-1\n",
    "etc/os-release": OS_RELEASE,
}


def write_atomic(path: Path, text: str) -> None:
    """Write `text` to `path` (creating its folder) through a .part file and one rename, so a
    reader sees the old file or the new one, never half of either."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    partial.write_text(text, encoding="utf-8")
    partial.replace(path)


def prepare(folder: Path) -> None:
    """Write the static files, the same on every instance. Each write is atomic."""
    for name, text in STATIC_FILES.items():
        write_atomic(folder / name, text)
    (folder / INVOICE_DIR).mkdir(parents=True, exist_ok=True)


def virtual_path(requested: str) -> str:
    """Where a requested invoice name points, with the folder as "/"."""
    text = requested.replace("\\", "/")
    base = text if text.startswith("/") else f"/{INVOICE_DIR}/{text}"
    return "/" + posixpath.normpath(base).lstrip("/")


def read(shop: Shop, requested: str) -> bytes | None:
    if not requested or "\x00" in requested:
        return None
    virtual = virtual_path(requested)
    invoice = _INVOICE.fullmatch(virtual)
    if invoice is not None:
        text = store.invoice(shop, int(invoice.group(1)))
        return text.encode() if text is not None else None
    root = shop.files.resolve()
    try:
        target = (root / virtual.lstrip("/")).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            return None
        fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:  # a name too long, a file removed or swapped for a link after the check
        return None
    with os.fdopen(fd, "rb") as handle:
        return handle.read(MAX_FILE_BYTES)
