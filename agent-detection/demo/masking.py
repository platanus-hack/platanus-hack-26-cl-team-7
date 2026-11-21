"""The twin's data policy (config/mask.yaml) and the projection of real rows through it.

A projection is what the twin may hold: per listed table, id -> row in schema column order.
Public columns keep the real value; masked columns get the values of a made-up person drawn
from the policy key and the person's id alone, never from a real value; every other column is
None. Mask and sync both use it, so a row looks the same whichever job wrote it.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import yaml

from demo import db, fake
from demo.tables import SQL

PUBLIC = "public"
UNIQUE_KINDS = ("username", "email")
Row = tuple[object, ...]


@dataclass(frozen=True)
class Masked:
    kind: str
    person: str


Rule = Masked | str  # a Masked column or PUBLIC


@dataclass(frozen=True)
class Policy:
    key: str
    tables: Mapping[str, Mapping[str, Rule]]
    admin_role: str
    recent_orders: int


@dataclass(frozen=True)
class Canary:
    kind: str
    table: str
    column: str
    row_id: int
    value: str


def _rule(where: str, raw: object, listed: Mapping[str, object]) -> Rule:
    if raw == PUBLIC:
        return PUBLIC
    if isinstance(raw, dict) and set(raw) == {"mask", "person"}:
        kind, person = str(raw["mask"]), str(raw["person"])
        if kind in fake.PERSON_FIELDS and listed.get(person) == PUBLIC:
            return Masked(kind, person)
    raise ValueError(f"{where}: expected 'public' or {{mask: <kind>, person: <public column>}}")


def load_policy(path: Path) -> Policy:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    tables: dict[str, dict[str, Rule]] = {}
    for table, cols in dict(data["tables"]).items():
        if table not in SQL or not isinstance(cols, dict) or cols.get("id") != PUBLIC:
            raise ValueError(f"{path}: table {table!r} is unknown or lacks 'id: public'")
        tables[table] = {c: _rule(f"{path}: {table}.{c}", r, cols) for c, r in cols.items()}
    marks = dict(data.get("canaries") or {})
    return Policy(
        str(data["key"]),
        tables,
        str(marks.get("admin_role", "")),
        int(marks.get("recent_orders", 0)),
    )


class Projection:
    def __init__(self, policy: Policy, real: sqlite3.Connection) -> None:
        self.policy = policy
        self.columns = {t: db.columns(real, t) for t in policy.tables}
        source = {t: [tuple(r) for r in real.execute(SQL[t].select_all)] for t in policy.tables}
        for table, rules in policy.tables.items():
            unknown = set(rules) - set(self.columns[table])
            if unknown:
                raise ValueError(f"{table}: no such columns {sorted(unknown)}")
        self.people = self._people(source)
        self.tables = {t: dict(self._project(t, rows)) for t, rows in source.items()}

    def masked(self) -> list[tuple[str, int, Masked]]:
        """(table, column index, rule) of every masked column."""
        return [
            (t, self.columns[t].index(c), rule)
            for t, rules in self.policy.tables.items()
            for c, rule in rules.items()
            if isinstance(rule, Masked)
        ]

    def _people(self, source: Mapping[str, list[Row]]) -> dict[int, fake.Person]:
        real: dict[str, set[object]] = {kind: set() for kind in fake.PERSON_FIELDS}
        subjects: set[int] = set()
        for table, index, rule in self.masked():
            person = self.columns[table].index(rule.person)
            real[rule.kind].update(row[index] for row in source[table])
            subjects.update(
                int(str(row[person])) for row in source[table] if row[person] is not None
            )
        taken: set[str] = set()

        def rejects(p: fake.Person) -> bool:
            clash = any(p.field(kind) in values for kind, values in real.items())
            return clash or any(p.field(kind) in taken for kind in UNIQUE_KINDS)

        people: dict[int, fake.Person] = {}
        for subject in sorted(subjects):
            chosen = fake.first_person(fake.Draw(self.policy.key, "person", subject), rejects)
            taken.update(chosen.field(kind) for kind in UNIQUE_KINDS)
            people[subject] = chosen
        return people

    def _project(self, table: str, rows: list[Row]) -> list[tuple[int, Row]]:
        names, rules = self.columns[table], self.policy.tables[table]
        key = names.index("id")
        out = []
        for row in rows:
            values: list[object] = []
            for name, value in zip(names, row, strict=True):
                rule = rules.get(name)
                if isinstance(rule, Masked):
                    owner = row[names.index(rule.person)]
                    values.append(
                        None if owner is None else self.people[int(str(owner))].field(rule.kind)
                    )
                else:
                    values.append(value if rule == PUBLIC else None)
            out.append((int(str(row[key])), tuple(values)))
        return out

    def canaries(self) -> list[Canary]:
        """Ordinary private values only the twin holds: the admin's masked contact details and
        the masked ship-to addresses of the newest orders. Never a secret or a key."""
        wanted: list[tuple[str, str, str, int]] = []
        if "users" in self.tables:
            role = self.columns["users"].index("role")
            admins = [
                i for i, row in self.tables["users"].items() if row[role] == self.policy.admin_role
            ]
            for column in ("email", "phone", "address"):
                wanted += [(f"admin_{column}", "users", column, i) for i in admins]
        if "orders" in self.tables and self.policy.recent_orders > 0:
            placed = self.columns["orders"].index("created_at")
            newest = sorted(
                self.tables["orders"].items(), key=lambda kv: (str(kv[1][placed]), kv[0])
            )
            for row_id, _ in newest[-self.policy.recent_orders :]:
                wanted.append(("order_address", "orders", "ship_address", row_id))
        found: dict[str, Canary] = {}
        for kind, table, column, row_id in wanted:
            if not isinstance(self.policy.tables[table].get(column), Masked):
                continue
            value = self.tables[table][row_id][self.columns[table].index(column)]
            if isinstance(value, str) and value and value not in found:
                found[value] = Canary(kind, table, column, row_id, value)
        return list(found.values())
