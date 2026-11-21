"""`python -m demo.seed --db run/real.db`: realistic real-side shop data.

Hundreds of users, thousands of orders with a status history spread over months, the catalogue
and one admin. The same seed and anchor give the same rows on every run. User 1 is the admin,
with a personal username and no known password. User 2 is the demo customer, the one login the
docs name.
"""

from __future__ import annotations

import argparse
import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

from demo import db, fake
from demo.auth import password_hash
from demo.catalog import CATALOGUE

DEFAULT_DB = Path("run/real.db")
ADMIN_ID, DEMO_ID = 1, 2
DEMO_LOGIN = ("alice", "wonderland")  # the public demo customer login the docs name
DEMO_NAME, DEMO_EMAIL = "Alice Liddell", "alice.liddell@gmail.com"
HISTORY_DAYS = 420
STAMP = "%Y-%m-%dT%H:%M:%SZ"
MINUTES_PER_DAY = 24 * 60
MAX_LINES, MAX_QUANTITY = 4, 3
GIFT_SHARE, CANCEL_SHARE = 6, 25  # one order in 6 ships elsewhere, one in 25 is cancelled
STOCK_SPAN = 120
# (status, days after the order the step happens at the earliest, extra days it may take)
STEPS = (("paid", 0, 0), ("shipped", 1, 2), ("delivered", 3, 4))
PASSWORD_SPAN = 1 << 64
INSERTS = {
    "orders": "INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    "order_items": "INSERT INTO order_items VALUES (?, ?, ?, ?, ?)",
    "order_events": "INSERT INTO order_events VALUES (?, ?, ?, ?)",
}


@dataclass(frozen=True)
class Plan:
    seed: int = 7
    users: int = 400
    orders: int = 3000
    anchor: datetime = field(default_factory=lambda: datetime.now(UTC).replace(microsecond=0))

    def __post_init__(self) -> None:
        if self.users <= DEMO_ID or self.orders < 0:
            raise ValueError(f"need more than {DEMO_ID} users and no negative order count")


def stamp(moment: datetime) -> str:
    return moment.strftime(STAMP)


def at(plan: Plan, draw: fake.Draw, label: str, earliest: datetime) -> datetime:
    """A moment between `earliest` and the anchor."""
    span = max(int((plan.anchor - earliest).total_seconds()) // 60, 1)
    return earliest + timedelta(minutes=draw.number(label, span))


def user_rows(plan: Plan) -> Iterator[tuple[object, ...]]:
    taken = {DEMO_LOGIN[0], DEMO_EMAIL}
    start = plan.anchor - timedelta(days=HISTORY_DAYS)
    for user_id in range(1, plan.users + 1):
        draw = fake.Draw(plan.seed, "user", user_id)
        person = fake.first_person(draw, lambda p: p.username in taken or p.email in taken)
        taken.update((person.username, person.email))
        if user_id == DEMO_ID:
            person = replace(person, name=DEMO_NAME, username=DEMO_LOGIN[0], email=DEMO_EMAIL)
        role = "admin" if user_id == ADMIN_ID else "customer"
        unknown = f"{draw.number('password', PASSWORD_SPAN):016x}"  # never shown or logged
        password = DEMO_LOGIN[1] if user_id == DEMO_ID else unknown
        created = start if user_id == ADMIN_ID else at(plan, draw, "joined", start)
        yield (
            user_id, person.username, person.name, person.email, person.phone, person.address,
            role, password_hash(password), None, stamp(created),
        )


def order_rows(
    plan: Plan, users: list[tuple[object, ...]]
) -> Iterator[tuple[str, tuple[object, ...]]]:
    """("orders" | "order_items" | "order_events", row) in insert order."""
    item_id = event_id = 0
    for order_id in range(1, plan.orders + 1):
        draw = fake.Draw(plan.seed, "order", order_id)
        user = users[draw.number("user", len(users))]
        joined = datetime.strptime(str(user[9]), STAMP).replace(tzinfo=UTC)
        placed = at(plan, draw, "placed", joined)
        name, address = str(user[2]), str(user[5])
        if draw.number("gift", GIFT_SHARE) == 0:
            gift = fake.person(draw.child("gift"))
            name, address = gift.name, gift.address
        lines = []
        for line in range(1 + draw.number("lines", MAX_LINES)):
            product = 1 + draw.number(f"product{line}", len(CATALOGUE))
            quantity = 1 + draw.number(f"quantity{line}", MAX_QUANTITY)
            lines.append((product, quantity, CATALOGUE[product - 1].price_cents))
        history = [("placed", placed)]
        cancelled = draw.number("cancel", CANCEL_SHARE) == 0
        for status, days, extra in (STEPS[:1] if cancelled else STEPS):
            when = history[-1][1] + timedelta(
                days=days, minutes=draw.number(status, (extra + 1) * MINUTES_PER_DAY)
            )
            if when > plan.anchor:
                break
            history.append((status, when))
        if cancelled:
            history.append(("cancelled", history[-1][1] + timedelta(hours=1)))
        total = sum(quantity * cents for _, quantity, cents in lines)
        status, last = history[-1]
        yield "orders", (
            order_id, user[0], status, total, name, address, stamp(placed), stamp(last),
        )
        for product, quantity, cents in lines:
            item_id += 1
            yield "order_items", (item_id, order_id, product, quantity, cents)
        for status, when in history:
            event_id += 1
            yield "order_events", (event_id, order_id, status, stamp(when))


def fill(plan: Plan, conn: sqlite3.Connection) -> None:
    start, stock = stamp(plan.anchor - timedelta(days=HISTORY_DAYS)), fake.Draw(plan.seed, "stock")
    conn.executemany(
        "INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)",
        [
            (n, *item, stock.number(str(n), STOCK_SPAN), start)
            for n, item in enumerate(CATALOGUE, start=1)
        ],
    )
    users = list(user_rows(plan))
    conn.executemany("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", users)
    customers = [u for u in users if u[6] == "customer"]
    for table, row in order_rows(plan, customers):
        conn.execute(INSERTS[table], row)


def seed(path: Path, plan: Plan) -> None:
    db.build(path, lambda conn: fill(plan, conn))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="demo.seed", description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--seed", type=int, default=Plan.seed)
    parser.add_argument("--users", type=int, default=Plan.users)
    parser.add_argument("--orders", type=int, default=Plan.orders)
    parser.add_argument("--anchor", type=datetime.fromisoformat, help="newest moment (ISO)")
    args = parser.parse_args(argv)
    anchor = args.anchor or Plan().anchor
    seed(args.db, Plan(args.seed, args.users, args.orders, anchor.astimezone(UTC)))
    print(f"seeded {args.db}: {args.users} users, {args.orders} orders", flush=True)


if __name__ == "__main__":
    main()
