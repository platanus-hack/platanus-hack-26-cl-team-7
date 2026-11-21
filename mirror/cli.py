"""python -m mirror: the attacker mirror router, in one process.

The process holds one key table, one patch book and one reporter, in a Router. Each listener in
LISTENERS takes that Router and returns a server: the lane endpoint here, and the tap (--tap)
and the callback relay (--relay) beside it, so all of them share the same in-memory keys.
main() serves every listener on its own thread until SIGINT or SIGTERM, then closes the servers,
flushes the reporter and closes the journals. A listener that cannot start exits with code 2.
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import socketserver
import sys
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from urllib.parse import urlsplit

import yaml

from engine.config import load_thresholds
from engine.detector import Detector
from engine.routes import RouteTable
from mirror.keys import KeyTable
from mirror.lane import LaneRouter, copy_session, handler_for
from mirror.patches import PatchBook
from mirror.reporter import SentinelReporter
from mirror.sockets import UnixHTTPServer

INGEST_ENV = "SENTINEL_INGEST_TOKEN"
EXIT_USAGE = 2
RUN = Path("run")
CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
DEFAULT_RELAY = "127.0.0.1:8097"
DEFAULT_SENTINEL = "http://127.0.0.1:8787"
SENTINEL_SCHEMES = frozenset({"http", "https"})
STOP_POLL = 0.5  # seconds between checks of the stop event, so signals are seen promptly

log = logging.getLogger("mirror")


@dataclass(frozen=True, slots=True)
class RouterConfig:
    lane: Path
    tap: Path
    relay: tuple[str, int]
    real: Path
    twin: Path
    sync: Path
    sentinel: str
    state: Path
    spool: Path
    canaries: Path
    patches: Path
    routes: Path
    rules: Path


@dataclass(frozen=True, slots=True)
class Router:
    """What every listener shares: one key table, one patch book, one reporter, one lane."""

    config: RouterConfig
    keys: KeyTable
    patches: PatchBook
    reporter: SentinelReporter
    lane: LaneRouter

    def close(self) -> None:
        self.reporter.close()
        self.keys.close()
        self.patches.close()


Listener = Callable[[Router], socketserver.BaseServer]


def lane_listener(router: Router) -> socketserver.BaseServer:
    return UnixHTTPServer(router.config.lane, handler_for(router.lane))


LISTENERS: tuple[Listener, ...] = (lane_listener,)


def build_router(config: RouterConfig, token: str) -> Router:
    routes = RouteTable.from_yaml(config.routes)
    detector = Detector(routes, load_thresholds(config.rules))
    keys = KeyTable.load(config.state)
    patches = PatchBook.load(config.patches, routes)
    reporter = SentinelReporter.to_sentinel(config.sentinel, token, config.spool)
    lane = LaneRouter(detector, keys, patches, reporter.emit, partial(copy_session, config.sync))
    return Router(config, keys, patches, reporter, lane)


def main(
    argv: Sequence[str] | None = None,
    *,
    listeners: Sequence[Listener] = LISTENERS,
    stop: threading.Event | None = None,
) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    config = parse_config(argv)
    token = os.environ.get(INGEST_ENV, "")
    if not token:
        print(f"mirror: set {INGEST_ENV} to Sentinel's ingest token", file=sys.stderr)
        return EXIT_USAGE
    try:
        router = build_router(config, token)
    except (OSError, ValueError, yaml.YAMLError) as err:
        print(f"mirror: bad config or state: {err}", file=sys.stderr)
        return EXIT_USAGE
    servers: list[socketserver.BaseServer] = []
    try:
        for listen in listeners:
            servers.append(listen(router))
    except OSError as err:
        print(f"mirror: cannot listen: {err}", file=sys.stderr)
        _close(servers, router, serving=False)
        return EXIT_USAGE
    _serve(servers, router, stop or _stop_on_signals())
    return 0


def parse_config(argv: Sequence[str] | None) -> RouterConfig:
    parser = argparse.ArgumentParser(prog="python -m mirror", description=__doc__)
    for name, default in (
        ("lane", "lane.sock"),
        ("tap", "tap.sock"),
        ("real", "real.sock"),
        ("twin", "twin.sock"),
        ("sync", "sync.sock"),
        ("state", "mirror-keys.jsonl"),
        ("spool", "mirror-spool.jsonl"),
        ("canaries", "canaries.json"),
        ("patches", "mirror-patches.jsonl"),
    ):
        parser.add_argument(f"--{name}", type=Path, default=RUN / default)
    parser.add_argument("--relay", type=_address, default=DEFAULT_RELAY, help="host:port")
    parser.add_argument("--sentinel", default=DEFAULT_SENTINEL, help="Sentinel base URL")
    parser.add_argument("--routes", type=Path, default=CONFIG_DIR / "routes.yaml")
    parser.add_argument("--rules", type=Path, default=CONFIG_DIR / "rules.yaml")
    args = parser.parse_args(argv)
    target = urlsplit(args.sentinel)
    if target.scheme not in SENTINEL_SCHEMES or not target.hostname:
        parser.error(f"--sentinel must be http(s)://host[:port], not {args.sentinel!r}")
    return RouterConfig(**vars(args))


def _address(text: str) -> tuple[str, int]:
    host, sep, port = text.rpartition(":")
    if not sep or not host or not port.isdigit() or not 0 < int(port) < 2**16:
        raise argparse.ArgumentTypeError(f"expected host:port, got {text!r}")
    return host, int(port)


def _serve(servers: list[socketserver.BaseServer], router: Router, stop: threading.Event) -> None:
    router.reporter.start()
    for server in servers:
        threading.Thread(target=server.serve_forever, name=type(server).__name__).start()
    log.info("mirror: serving %d listener(s)", len(servers))
    try:
        while not stop.is_set():
            stop.wait(STOP_POLL)
    finally:
        _close(servers, router, serving=True)


def _close(servers: list[socketserver.BaseServer], router: Router, *, serving: bool) -> None:
    for server in servers:
        if serving:  # shutdown() waits for serve_forever(), so only a serving server may get it
            server.shutdown()
        server.server_close()
    router.close()


def _stop_on_signals() -> threading.Event:
    stop = threading.Event()
    for number in (signal.SIGINT, signal.SIGTERM):
        signal.signal(number, lambda *_: stop.set())
    return stop
