"""`python -m demo.mask --from run/real.db --to run/twin.db --allow config/mask.yaml`

Builds the twin's database from the real one, one way: the real file is only read, and the twin
gets only what the allow list lets through (see config/mask.yaml and demo.masking). The new twin
file replaces the old one in one rename. Also writes the canaries (run/canaries.json next to
the twin database unless --canaries says otherwise) for the router's canary-read finding.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sqlite3
from pathlib import Path

from demo import db
from demo.masking import Canary, Policy, Projection, load_policy
from demo.tables import SQL

DEFAULT_POLICY = Path("config/mask.yaml")
CANARIES_VERSION = 1


def project(real: Path, policy: Policy) -> Projection:
    """Read the real database through the policy. Opens the real file read-only."""
    with contextlib.closing(db.connect(real, db.READ_ONLY)) as conn:
        return Projection(policy, conn)


def write_twin(projection: Projection, twin: Path) -> None:
    def fill(conn: sqlite3.Connection) -> None:
        for table, rows in projection.tables.items():
            conn.executemany(SQL[table].replace, rows.values())

    db.build(twin, fill)


def canary_document(canaries: list[Canary]) -> dict[str, object]:
    """{"version": 1, "canaries": [{"kind", "table", "column", "rowId", "value"}, ...]}"""
    items = [
        {"kind": c.kind, "table": c.table, "column": c.column, "rowId": c.row_id, "value": c.value}
        for c in canaries
    ]
    return {"version": CANARIES_VERSION, "canaries": items}


def write_canaries(canaries: list[Canary], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    partial.write_text(json.dumps(canary_document(canaries), indent=2) + "\n", encoding="utf-8")
    partial.replace(path)


def mask(real: Path, twin: Path, policy: Policy, canaries: Path) -> Projection:
    if real.resolve() == twin.resolve():
        raise ValueError("the twin database must be another file than the real one")
    projection = project(real, policy)
    write_twin(projection, twin)
    write_canaries(projection.canaries(), canaries)
    return projection


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="demo.mask", description="Build the twin database.")
    parser.add_argument("--from", dest="real", type=Path, required=True)
    parser.add_argument("--to", dest="twin", type=Path, required=True)
    parser.add_argument("--allow", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--canaries", type=Path, help="default: canaries.json next to --to")
    args = parser.parse_args(argv)
    canaries = args.canaries or args.twin.with_name("canaries.json")
    projection = mask(args.real, args.twin, load_policy(args.allow), canaries)
    counts = ", ".join(f"{len(rows)} {table}" for table, rows in projection.tables.items())
    print(f"masked {args.real} -> {args.twin} ({counts}); canaries in {canaries}", flush=True)


if __name__ == "__main__":
    main()
