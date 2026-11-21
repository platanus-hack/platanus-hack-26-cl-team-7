"""Level-3 base-rate test: a few probe sessions hidden among many synthetic human sessions."""

from __future__ import annotations

import dataclasses
import random
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

import yaml

from engine.config import load_thresholds
from engine.detector import Detector, replay
from engine.models import Label, Request, Verdict
from engine.routes import RouteTable
from eval.dataset import Split, load_split
from eval.metrics import POSITIVE
from eval.synthetic import SeededRandom, synthetic_humans

__all__ = [
    "RATIO",
    "BaseRateRun",
    "false_alarms_per_1000",
    "mix_base_rate",
    "run_base_rate",
    "synthetic_humans",
]

RATIO = 10_000


def mix_base_rate(
    humans: Sequence[Sequence[Request]],
    probes: Sequence[Sequence[Request]],
    seed: int,
    ratio: int = RATIO,
) -> Split:
    rng = SeededRandom(seed)
    wanted = len(humans) // ratio
    if wanted > len(probes):
        raise ValueError(f"need {wanted} probe sessions, the pool has {len(probes)}")
    stamps = [req.ts for session in humans for req in session]
    low, high = (min(stamps), max(stamps)) if stamps else (0.0, 0.0)
    split = Split(requests=[], labels={}, synthetic={"synthetic-humans": True})
    for session in humans:
        _add(split, list(session), "human", "synthetic-humans")
    for index in rng.sample(range(len(probes)), wanted):
        _add(split, _shift(rng, probes[index], low, high), "probing", "probe-pool")
    split.requests.sort(key=lambda req: req.ts)
    return split


def false_alarms_per_1000(labels: Mapping[str, Label], verdicts: Iterable[Verdict]) -> float | None:
    humans = {sid for sid, label in labels.items() if label == "human"}
    if not humans:
        return None
    flagged = {item.session_id for item in verdicts} & humans
    return 1000.0 * len(flagged) / len(humans)


@dataclasses.dataclass(frozen=True)
class BaseRateRun:
    routes: Path
    rules: Path
    probe_dir: Path
    humans: int = 20_000
    seed: int = 1
    ratio: int = RATIO


def run_base_rate(run: BaseRateRun) -> dict[str, Any]:
    patterns = load_patterns(run.routes)
    people = synthetic_humans(patterns, run.humans, run.seed)
    mixed = mix_base_rate(people, probe_sessions(load_split(run.probe_dir)), run.seed, run.ratio)
    detector = Detector(RouteTable.from_patterns(patterns), load_thresholds(run.rules))
    verdicts = replay(mixed.requests, detector)
    flagged = {item.session_id for item in verdicts}
    probes = [sid for sid, label in mixed.labels.items() if label == "probing"]
    return {
        "ratio": run.ratio,
        "seed": run.seed,
        "human_sessions": len(people),
        "human_sessions_synthetic": True,
        "probe_sessions": len(probes),
        "probe_source": str(run.probe_dir),
        "flagged_human_sessions": sum(1 for s in people if s and s[0].session_id in flagged),
        "detected_probe_sessions": sum(1 for sid in probes if sid in flagged),
        "false_alarms_per_1000_humans": false_alarms_per_1000(mixed.labels, verdicts),
    }


def load_patterns(routes_path: Path) -> list[dict[str, object]]:
    data = yaml.safe_load(routes_path.read_text(encoding="utf-8")) or {}
    routes = data.get("routes") if isinstance(data, dict) else None
    if not isinstance(routes, list):
        raise ValueError(f"{routes_path}: needs a 'routes' list")
    return [dict(item) for item in routes if isinstance(item, dict)]


def probe_sessions(split: Split) -> list[list[Request]]:
    grouped: dict[str, list[Request]] = defaultdict(list)
    for req in split.requests:
        if split.labels.get(req.session_id) in POSITIVE:
            grouped[req.session_id].append(req)
    return [grouped[sid] for sid in sorted(grouped)]


def _shift(
    rng: random.Random, session: Sequence[Request], low: float, high: float
) -> list[Request]:
    ordered = sorted(session, key=lambda req: req.ts)
    if not ordered:
        return []
    duration = ordered[-1].ts - ordered[0].ts
    start = rng.uniform(low, max(low, high - duration))
    offset = start - ordered[0].ts
    return [dataclasses.replace(req, ts=req.ts + offset) for req in ordered]


def _add(split: Split, session: list[Request], label: Label, source: str) -> None:
    for session_id in {req.session_id for req in session}:
        if session_id in split.labels:
            raise ValueError(f"session {session_id!r} appears twice in the base-rate mix")
        split.labels[session_id] = label
        split.sources[session_id] = source
    split.requests.extend(session)
