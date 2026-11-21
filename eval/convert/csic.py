"""CSIC 2010 HTTP dataset: parse the raw request dumps and plan replay sessions.

The dataset (normalTrafficTraining.txt, normalTrafficTest.txt, anomalousTrafficTest.txt) is a
dump of raw HTTP/1.1 requests to a Spanish web shop: a request line with an absolute URL, header
lines, a blank line and, for POST and PUT, one line of form-encoded body. The files are outside
data, so the parser only reads text and never trusts a length it cannot check.
"""

from __future__ import annotations

import json
import random
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from engine.models import Label

CSIC_USER_AGENT = "Mozilla/5.0 (compatible; Konqueror/3.5; Linux) KHTML/3.5.8 (like Gecko)"
_REQUEST_LINE = re.compile(r"^(GET|POST|PUT|DELETE|HEAD|OPTIONS) (\S+) HTTP/1\.[01]$")
_IP_PREFIX = "10.210"


@dataclass(frozen=True, slots=True)
class CsicRequest:
    method: str
    target: str  # path plus "?query" when present, without scheme and host
    user_agent: str
    body: str = ""
    content_type: str = ""

    @property
    def path(self) -> str:
        return self.target.partition("?")[0]

    @property
    def query(self) -> str:
        return self.target.partition("?")[2]


def parse_requests(text: str) -> list[CsicRequest]:
    """Every request in one CSIC dump, in file order. Lines that start no request are skipped."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    requests: list[CsicRequest] = []
    index = 0
    while index < len(lines):
        found = _REQUEST_LINE.match(lines[index])
        index += 1
        if found is None:
            continue
        headers, index = _headers(lines, index)
        body = ""
        if "content-length" in headers and index < len(lines):
            body = lines[index]
            index += 1
        requests.append(
            CsicRequest(
                method=found.group(1),
                target=_target(found.group(2)),
                user_agent=headers.get("user-agent", ""),
                body=body,
                content_type=headers.get("content-type", ""),
            )
        )
    return requests


def read_dump(path: Path) -> list[CsicRequest]:
    return parse_requests(path.read_text(encoding="latin-1"))


def _headers(lines: Sequence[str], index: int) -> tuple[dict[str, str], int]:
    headers: dict[str, str] = {}
    while index < len(lines) and lines[index].strip():
        name, _, value = lines[index].partition(":")
        headers[name.strip().lower()] = value.strip()
        index += 1
    return headers, index + 1


def _target(url: str) -> str:
    parts = urlsplit(url)
    if not parts.scheme:
        return url
    return (parts.path or "/") + (f"?{parts.query}" if parts.query else "")


def plan_sessions(
    requests: Sequence[CsicRequest],
    count: int,
    seed: int,
    sizes: tuple[int, int] = (10, 30),
) -> list[list[CsicRequest]]:
    """Cut the dump into runs of consecutive requests and pick `count` of them (file order)."""
    low, high = sizes
    if not 0 < low <= high:
        raise ValueError(f"session sizes must satisfy 0 < min <= max, got {sizes}")
    rng = random.Random(seed)
    runs: list[list[CsicRequest]] = []
    start = 0
    while start + low <= len(requests):
        size = rng.randint(low, high)
        runs.append(list(requests[start : start + size]))
        start += size
    if count > len(runs):
        raise ValueError(f"asked for {count} sessions, the dump has only {len(runs)}")
    picked = sorted(rng.sample(range(len(runs)), count))
    return [runs[index] for index in picked]


def session_ip(index: int) -> str:
    """A distinct private address per replayed session: 10.210.<hi>.<lo>, lo in 1..250."""
    if not 0 <= index < 250 * 256:
        raise ValueError(f"session index {index} is out of range")
    return f"{_IP_PREFIX}.{index // 250}.{index % 250 + 1}"


def assign_splits(count: int, seed: int) -> list[str]:
    """Split names per session index: half "tune", the rest "test", in a seeded order."""
    order = list(range(count))
    random.Random(seed).shuffle(order)
    tune = set(order[: count // 2])
    return ["tune" if index in tune else "test" for index in range(count)]


def rewrite_line(line: str, ip: str, drop_header: str) -> str:
    """Set the client address of one Caddy JSON line and remove the recorder's tag header."""
    entry = json.loads(line)
    request = entry["request"]
    request["client_ip"] = ip
    request["remote_ip"] = ip
    headers = request.get("headers")
    if isinstance(headers, dict):
        headers.pop(drop_header, None)
    return json.dumps(entry, separators=(",", ":"))


def write_pair(
    directory: Path,
    name: str,
    lines: Sequence[str],
    sessions: dict[str, Label],
    notes: str,
) -> Path:
    """Write <name>.jsonl and <name>.labels.json in the eval data format."""
    directory.mkdir(parents=True, exist_ok=True)
    log_path = directory / f"{name}.jsonl"
    log_path.write_text("".join(line + "\n" for line in lines), encoding="utf-8")
    labels = {"source": "csic2010", "synthetic": False, "notes": notes, "sessions": sessions}
    labels_file = directory / f"{name}.labels.json"
    labels_file.write_text(json.dumps(labels, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return log_path
