"""Command line: replay a log into JSONL verdicts, or follow a live log and post each verdict."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import TextIO

import yaml

from engine.config import load_thresholds
from engine.detector import Detector
from engine.logreader import follow, read_requests
from engine.models import Request, Verdict
from engine.routes import RouteTable
from engine.webhook import post_verdict

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
EXIT_USAGE = 2


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        detector = Detector(RouteTable.from_yaml(args.routes), load_thresholds(args.rules))
    except (OSError, ValueError, yaml.YAMLError) as err:
        print(f"engine: bad config: {err}", file=sys.stderr)
        return EXIT_USAGE
    try:
        if args.command == "replay":
            return run_replay(read_requests(args.log), detector)
        return run_follow(follow(args.log, from_start=args.from_start), detector, args.webhook)
    except OSError as err:
        print(f"engine: {err}", file=sys.stderr)
        return EXIT_USAGE
    except KeyboardInterrupt:
        return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m engine", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    replay = commands.add_parser("replay", help="print one JSON verdict per line for a whole log")
    _add_common(replay)
    tail = commands.add_parser("follow", help="tail a live log and POST verdicts to a webhook")
    _add_common(tail)
    tail.add_argument("--webhook", required=True, help="dashboard webhook URL")
    tail.add_argument("--from-start", action="store_true", help="read existing lines first")
    return parser


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("log", type=Path, help="Caddy JSON access log")
    parser.add_argument("--routes", type=Path, default=CONFIG_DIR / "routes.yaml")
    parser.add_argument("--rules", type=Path, default=CONFIG_DIR / "rules.yaml")


def run_replay(requests: Iterable[Request], detector: Detector, out: TextIO | None = None) -> int:
    for req in requests:
        for verdict in detector.process(req):
            emit(verdict, out)
    return 0


def run_follow(
    requests: Iterable[Request], detector: Detector, webhook: str, out: TextIO | None = None
) -> int:
    for req in requests:
        for verdict in detector.process(req):
            emit(verdict, out)
            post_verdict(webhook, verdict)
    return 0


def emit(verdict: Verdict, out: TextIO | None = None) -> None:
    stream = out or sys.stdout
    stream.write(json.dumps(verdict.to_dict()) + "\n")
    stream.flush()
