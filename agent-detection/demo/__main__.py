"""Run the demo shop.

  python -m demo --socket run/real.sock --db run/real.db [--files run/real-files]
  python -m demo --socket run/twin.sock --db run/twin.db --files run/twin-files \\
      --egress-proxy http://127.0.0.1:8097
  python -m demo --port 8081            (TCP; without --db, a small seeded shop in a temp folder)

--files defaults to the folder next to the database named after it (run/real.db: run/real-files).
"""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from demo.seed import Plan, seed
from demo.site import ROUTES_FILE, make_server, make_unix_server, serve
from demo.web import Shop

SCRATCH_PLAN = Plan(users=60, orders=300)


def files_for(db: Path) -> Path:
    return db.with_name(db.stem + "-files")


def parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="demo", description="FreshJuice demo shop.")
    where = parser.add_mutually_exclusive_group()
    where.add_argument("--socket", type=Path, help="serve on this Unix socket path")
    where.add_argument("--port", type=int, default=8081, help="serve on TCP (default 8081)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--db", type=Path, help="the shop's SQLite file (WAL mode)")
    parser.add_argument("--files", type=Path, help="the only folder invoice downloads may read")
    parser.add_argument("--egress-proxy", help="the only way out for server-side fetches")
    parser.add_argument("--routes", type=Path, default=ROUTES_FILE)
    return parser.parse_args(argv)


def run(args: argparse.Namespace, db: Path) -> None:
    shop = Shop(db, args.files or files_for(db), args.egress_proxy)
    if args.socket is not None:
        serve(make_unix_server(shop, args.socket, args.routes), f"unix:{args.socket}")
    else:
        server = make_server(shop, args.host, args.port, args.routes)
        serve(server, f"http://{args.host}:{args.port}")


def main(argv: list[str] | None = None) -> None:
    args = parse(argv)
    if args.db is not None:
        run(args, args.db)
        return
    with tempfile.TemporaryDirectory(prefix="demo-shop-") as scratch:
        db = Path(scratch) / "shop.db"
        seed(db, SCRATCH_PLAN)
        run(args, db)


if __name__ == "__main__":
    main()
