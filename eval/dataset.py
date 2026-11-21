"""Labeled data: <name>.jsonl Caddy logs paired with <name>.labels.json session labels."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast, get_args

from engine.logreader import read_requests
from engine.models import Label, Request

SPLITS = ("tune", "test")
LABELS: frozenset[str] = frozenset(get_args(Label))


class DatasetError(ValueError):
    """Labeled data that breaks the eval data format."""


@dataclass
class Split:
    requests: list[Request]
    labels: dict[str, Label]
    sources: dict[str, str] = field(default_factory=dict)
    synthetic: dict[str, bool] = field(default_factory=dict)


def load_split(directory: Path) -> Split:
    split = Split(requests=[], labels={})
    for log_path in sorted(directory.rglob("*.jsonl")):
        _add_pair(split, log_path)
    split.requests.sort(key=lambda req: req.ts)
    return split


def load_dataset(data_dir: Path) -> dict[str, Split]:
    splits = {name: load_split(data_dir / name) for name in SPLITS}
    shared = sorted(splits["tune"].labels.keys() & splits["test"].labels.keys())
    if shared:
        raise DatasetError(f"sessions labeled in both tune and test: {', '.join(shared)}")
    return splits


def labels_path(log_path: Path) -> Path:
    return log_path.with_name(log_path.name.removesuffix(".jsonl") + ".labels.json")


def _add_pair(split: Split, log_path: Path) -> None:
    meta = _read_labels(labels_path(log_path))
    source = str(meta.get("source") or log_path.stem)
    sessions = _sessions(meta, log_path)
    requests = list(read_requests(log_path))
    for req in requests:
        label = sessions.get(req.session_id)
        if label is None:
            raise DatasetError(f"{log_path.name}: session {req.session_id!r} has no label")
        _set_label(split, req.session_id, label, log_path)
        split.sources[req.session_id] = source
    split.synthetic[source] = bool(meta.get("synthetic", False))
    split.requests.extend(requests)


def _read_labels(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise DatasetError(f"{path.name}: labels file missing")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise DatasetError(f"{path.name}: invalid JSON ({error})") from error
    if not isinstance(data, dict) or not isinstance(data.get("sessions"), dict):
        raise DatasetError(f"{path.name}: needs a 'sessions' object")
    return data


def _sessions(meta: dict[str, Any], log_path: Path) -> dict[str, Label]:
    sessions: dict[str, Label] = {}
    for session_id, label in meta["sessions"].items():
        if label not in LABELS:
            raise DatasetError(f"{log_path.name}: session {session_id!r} has label {label!r}")
        sessions[session_id] = cast(Label, label)
    return sessions


def _set_label(split: Split, session_id: str, label: Label, log_path: Path) -> None:
    known = split.labels.setdefault(session_id, label)
    if known != label:
        raise DatasetError(
            f"{log_path.name}: session {session_id!r} labeled {label!r} and {known!r}"
        )
