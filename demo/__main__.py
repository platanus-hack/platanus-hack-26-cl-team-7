"""`python -m demo --port 8081`: run the stand-in demo shop."""

from __future__ import annotations

import argparse
from pathlib import Path

from demo.site import ROUTES_FILE, serve


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="demo", description="Stand-in demo shop.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--routes", type=Path, default=ROUTES_FILE)
    args = parser.parse_args(argv)
    serve(args.host, args.port, args.routes)


if __name__ == "__main__":
    main()
