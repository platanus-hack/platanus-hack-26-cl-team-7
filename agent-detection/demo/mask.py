"""`python -m demo.mask --from run/real.db --to run/twin.db --allow config/mask.yaml`

Builds the twin's database from the real one, one way: the real file is only read, and the twin
gets only what the allow list lets through (see config/mask.yaml and demo.masking). The new twin
file replaces the old one in one rename. Also picks the canaries, the ordinary private values only
the twin holds, and writes them (run/canaries.json next to the twin database unless --canaries says
otherwise) for the router's canary-read finding.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from demo import db, files
from demo.db import SQL
from demo.masking import DEFAULT_POLICY, Masked, Policy, Projection, load_policy, project

CANARIES_VERSION = 1


@dataclass(frozen=True)
class Canary:
    kind: str
    table: str
    column: str
    row_id: int
    value: str


def write_twin(projection: Projection, twin: Path) -> None:
    def fill(conn: sqlite3.Connection) -> None:
        for table, rows in projection.tables.items():
            conn.executemany(SQL[table].replace, rows.values())

    db.build(twin, fill)


def canaries(projection: Projection) -> list[Canary]:
    """Ordinary private values only the twin holds: the admin's masked contact details and
    the masked ship-to addresses of the newest orders. Never a secret or a key."""
    tables, columns, policy = projection.tables, projection.columns, projection.policy
    wanted: list[tuple[str, str, str, int]] = []
    if "users" in tables:
        role = columns["users"].index("role")
        admins = [i for i, row in tables["users"].items() if row[role] == policy.admin_role]
        for column in ("email", "phone", "address"):
            wanted += [(f"admin_{column}", "users", column, i) for i in admins]
    if "orders" in tables and policy.recent_orders > 0:
        placed = columns["orders"].index("created_at")
        newest = sorted(tables["orders"].items(), key=lambda kv: (str(kv[1][placed]), kv[0]))
        for row_id, _ in newest[-policy.recent_orders :]:
            wanted.append(("order_address", "orders", "ship_address", row_id))
    found: dict[str, Canary] = {}
    for kind, table, column, row_id in wanted:
        if not isinstance(policy.tables[table].get(column), Masked):
            continue
        value = tables[table][row_id][columns[table].index(column)]
        if isinstance(value, str) and value and value not in found:
            found[value] = Canary(kind, table, column, row_id, value)
    return list(found.values())


def canary_document(found: list[Canary]) -> dict[str, object]:
    """{"version": 1, "canaries": [{"kind", "table", "column", "rowId", "value"}, ...]}"""
    items = [
        {"kind": c.kind, "table": c.table, "column": c.column, "rowId": c.row_id, "value": c.value}
        for c in found
    ]
    return {"version": CANARIES_VERSION, "canaries": items}


def mask(real: Path, twin: Path, policy: Policy, canaries_path: Path) -> Projection:
    if real.resolve() == twin.resolve():
        raise ValueError("the twin database must be another file than the real one")
    projection = project(real, policy)
    write_twin(projection, twin)
    text = json.dumps(canary_document(canaries(projection)), indent=2) + "\n"
    files.write_atomic(canaries_path, text)
    return projection


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="demo.mask", description="Build the twin database.")
    parser.add_argument("--from", dest="real", type=Path, required=True)
    parser.add_argument("--to", dest="twin", type=Path, required=True)
    parser.add_argument("--allow", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--canaries", type=Path, help="default: canaries.json next to --to")
    args = parser.parse_args(argv)
    canaries_path = args.canaries or args.twin.with_name("canaries.json")
    projection = mask(args.real, args.twin, load_policy(args.allow), canaries_path)
    counts = ", ".join(f"{len(rows)} {table}" for table, rows in projection.tables.items())
    print(f"masked {args.real} -> {args.twin} ({counts}); canaries in {canaries_path}", flush=True)


if __name__ == "__main__":
    main()
