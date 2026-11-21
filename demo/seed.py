"""`python -m demo.seed --db run/real.db`: realistic real-side shop data.

Hundreds of users, thousands of orders with a status history spread over months, the catalogue
and one admin. The same seed and anchor give the same rows on every run. Ids follow time, as in
a live shop: user 1 is the admin, who opened the shop (a personal username, no known password),
user 2 the demo customer (the one login the tests name), and order N + 1 was placed after N.
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
DEMO_LOGIN = ("alice", "wonderland")  # the demo customer login the tests and local demos use
DEMO_NAME, DEMO_EMAIL = "Alice Liddell", "alice.liddell@gmail.com"
HISTORY_DAYS = 420
DEMO_JOINED_DAY, CUSTOMERS_FROM_DAY = 1, 2  # days after the shop opened (the admin joined then)
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


def user_rows(plan: Plan) -> list[tuple[object, ...]]:
    """Users numbered in the order they joined: the admin first, then the demo customer."""
    taken = {DEMO_LOGIN[0], DEMO_EMAIL}
    start = plan.anchor - timedelta(days=HISTORY_DAYS)
    joined: list[tuple[datetime, int, fake.Person, str]] = []
    for slot in range(1, plan.users + 1):
        draw = fake.Draw(plan.seed, "user", slot)
        person = fake.first_person(draw, lambda p: p.username in taken or p.email in taken)
        taken.update((person.username, person.email))
        unknown = f"{draw.number('password', PASSWORD_SPAN):016x}"  # never shown or logged
        when = at(plan, draw, "joined", start + timedelta(days=CUSTOMERS_FROM_DAY))
        if slot == ADMIN_ID:
            when = start
        elif slot == DEMO_ID:
            person = replace(person, name=DEMO_NAME, username=DEMO_LOGIN[0], email=DEMO_EMAIL)
            when, unknown = start + timedelta(days=DEMO_JOINED_DAY), DEMO_LOGIN[1]
        joined.append((when, slot, person, unknown))
    joined.sort(key=lambda entry: (entry[0], entry[1]))
    return [
        (
            user_id, person.username, person.name, person.email, person.phone, person.address,
            "admin" if slot == ADMIN_ID else "customer", password_hash(password), None,
            stamp(when),
        )
        for user_id, (when, slot, person, password) in enumerate(joined, start=1)
    ]


@dataclass(frozen=True)
class Order:
    customer: tuple[object, ...]
    ship_name: str
    ship_address: str
    lines: tuple[tuple[int, int, int], ...]  # (product id, quantity, unit price in cents)
    history: tuple[tuple[str, datetime], ...]  # (status, when), the first is "placed"


def draft(plan: Plan, draw: fake.Draw, customers: list[tuple[object, ...]]) -> Order:
    customer = customers[draw.number("user", len(customers))]
    joined = datetime.strptime(str(customer[9]), STAMP).replace(tzinfo=UTC)
    name, address = str(customer[2]), str(customer[5])
    if draw.number("gift", GIFT_SHARE) == 0:
        gift = fake.person(draw.child("gift"))
        name, address = gift.name, gift.address
    lines = []
    for line in range(1 + draw.number("lines", MAX_LINES)):
        product = 1 + draw.number(f"product{line}", len(CATALOGUE))
        quantity = 1 + draw.number(f"quantity{line}", MAX_QUANTITY)
        lines.append((product, quantity, CATALOGUE[product - 1].price_cents))
    history = [("placed", at(plan, draw, "placed", joined))]
    cancelled = draw.number("cancel", CANCEL_SHARE) == 0
    for status, days, extra in STEPS[:1] if cancelled else STEPS:
        when = history[-1][1] + timedelta(
            days=days, minutes=draw.number(status, (extra + 1) * MINUTES_PER_DAY)
        )
        if when > plan.anchor:
            break
        history.append((status, when))
    if cancelled:
        history.append(("cancelled", history[-1][1] + timedelta(hours=1)))
    return Order(customer, name, address, tuple(lines), tuple(history))


def order_rows(
    plan: Plan, customers: list[tuple[object, ...]]
) -> Iterator[tuple[str, tuple[object, ...]]]:
    """("orders" | "order_items" | "order_events", row) in insert order. Orders are numbered in
    the order they were placed, as a live shop numbers them."""
    drafts = [draft(plan, fake.Draw(plan.seed, "order", n), customers) for n in range(plan.orders)]
    drafts.sort(key=lambda order: order.history[0][1])
    item_id = event_id = 0
    for order_id, order in enumerate(drafts, start=1):
        total = sum(quantity * cents for _, quantity, cents in order.lines)
        placed, (status, last) = order.history[0][1], order.history[-1]
        yield "orders", (
            order_id, order.customer[0], status, total, order.ship_name, order.ship_address,
            stamp(placed), stamp(last),
        )
        for product, quantity, cents in order.lines:
            item_id += 1
            yield "order_items", (item_id, order_id, product, quantity, cents)
        for step, when in order.history:
            event_id += 1
            yield "order_events", (event_id, order_id, step, stamp(when))


def fill(plan: Plan, conn: sqlite3.Connection) -> None:
    start, stock = stamp(plan.anchor - timedelta(days=HISTORY_DAYS)), fake.Draw(plan.seed, "stock")
    conn.executemany(
        "INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)",
        [
            (n, *item, stock.number(str(n), STOCK_SPAN), start)
            for n, item in enumerate(CATALOGUE, start=1)
        ],
    )
    users = user_rows(plan)
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
