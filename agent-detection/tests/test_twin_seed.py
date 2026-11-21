"""The real-side seed: realistic, deterministic shop data in a WAL-mode SQLite file."""

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from test_twin_support import ANCHOR, SMALL

from demo import db, fake
from demo.auth import password_hash
from demo.seed import DEMO_LOGIN, HISTORY_DAYS, STAMP, Plan, main, seed
from demo.tables import SQL

STATUSES = {"placed", "paid", "shipped", "delivered", "cancelled"}


@pytest.fixture(scope="module")
def real(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("seed") / "real.db"
    seed(path, SMALL)
    return path


def dump(path: Path) -> dict[str, list[tuple[object, ...]]]:
    with db.opened(path) as conn:
        return {t: [tuple(r) for r in conn.execute(sql.select_all)] for t, sql in SQL.items()}


def when(text: object) -> datetime:
    return datetime.strptime(str(text), STAMP).replace(tzinfo=ANCHOR.tzinfo)


def test_default_plan_is_hundreds_of_users_and_thousands_of_orders() -> None:
    assert Plan().users >= 200 and Plan().orders >= 1000
    with pytest.raises(ValueError, match="more than 2 users"):
        Plan(users=2)
    with pytest.raises(ValueError, match="no negative order count"):
        Plan(orders=-1)


def test_the_database_is_wal_mode_with_the_plan_counts(real: Path) -> None:
    with db.opened(real) as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        users = conn.execute("SELECT count(*) FROM users").fetchone()[0]
        orders = conn.execute("SELECT count(*) FROM orders").fetchone()[0]
        sessions = conn.execute("SELECT count(*) FROM sessions").fetchone()[0]
    assert (users, orders, sessions) == (SMALL.users, SMALL.orders, 0)
    assert not real.with_name("real.db.part").exists()


def test_same_seed_and_anchor_give_the_same_rows_and_another_seed_others(tmp_path: Path) -> None:
    seed(tmp_path / "a.db", SMALL)
    seed(tmp_path / "b.db", SMALL)
    seed(tmp_path / "c.db", Plan(seed=12, users=SMALL.users, orders=SMALL.orders, anchor=ANCHOR))
    assert dump(tmp_path / "a.db") == dump(tmp_path / "b.db")
    assert dump(tmp_path / "a.db")["users"] != dump(tmp_path / "c.db")["users"]


def test_users_are_realistic_unique_and_numbered_as_they_joined(real: Path) -> None:
    users = dump(real)["users"]
    usernames, emails = [u[1] for u in users], [u[3] for u in users]
    assert len(set(usernames)) == len(usernames) and len(set(emails)) == len(emails)
    admin, demo = users[0], users[1]
    assert admin[6] == "admin" and [u[6] for u in users[1:]] == ["customer"] * (len(users) - 1)
    assert admin[1] not in ("admin", "root") and "@" in str(admin[3])
    assert demo[1] == DEMO_LOGIN[0] and demo[7] == password_hash(DEMO_LOGIN[1])
    assert admin[7] != password_hash(DEMO_LOGIN[1]) and admin[8] is None
    joined = [when(u[9]) for u in users]
    assert joined == sorted(joined) and joined[0] == ANCHOR - timedelta(days=HISTORY_DAYS)
    for user in users:
        assert str(user[4]).startswith("+56 9 ") and str(user[5]).count(",") >= 1
        assert " " in str(user[2]) and str(user[3]).endswith(fake.EMAIL_DOMAINS)


def test_orders_have_items_totals_and_a_history_spread_over_months(real: Path) -> None:
    data = dump(real)
    joined = {u[0]: when(u[9]) for u in data["users"]}
    items: dict[object, int] = {}
    for item in data["order_items"]:
        items[item[1]] = items.get(item[1], 0) + int(str(item[3])) * int(str(item[4]))
    events: dict[object, list[tuple[str, datetime]]] = {}
    for event in data["order_events"]:
        events.setdefault(event[1], []).append((str(event[2]), when(event[3])))
    placed = [when(o[6]) for o in data["orders"]]
    assert placed == sorted(placed) and placed[-1] - placed[0] > timedelta(days=90)
    for order in data["orders"]:
        history = events[order[0]]
        assert order[1] != 1, "the admin places no orders"
        assert items[order[0]] == order[3] and order[2] == history[-1][0] in STATUSES
        assert history[0] == ("placed", when(order[6])) and history[-1][1] == when(order[7])
        assert [at for _, at in history] == sorted(at for _, at in history)
        assert joined[order[1]] <= when(order[6]) and history[-1][1] <= ANCHOR + timedelta(hours=1)
    statuses = {o[2] for o in data["orders"]}
    assert {"delivered", "cancelled"} <= statuses
    shipped_elsewhere = sum(o[4] != data["users"][int(str(o[1])) - 1][2] for o in data["orders"])
    assert 0 < shipped_elsewhere < len(data["orders"]) / 2


def test_a_failed_build_leaves_the_old_database_whole(real: Path, tmp_path: Path) -> None:
    target = tmp_path / "shop.db"
    seed(target, SMALL)
    before = dump(target)

    def broken(conn: sqlite3.Connection) -> None:
        conn.execute("INSERT INTO products VALUES (1, 'x', 'x', 1, 1, 'now')")
        raise sqlite3.IntegrityError("disk full")

    with pytest.raises(sqlite3.IntegrityError):
        db.build(target, broken)
    assert dump(target) == before
    seed(target, Plan(seed=3, users=5, orders=4, anchor=ANCHOR))
    assert len(dump(target)["users"]) == 5 and not target.with_name("shop.db.part").exists()


def test_main_seeds_the_named_file(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    target = tmp_path / "run" / "real.db"
    main(["--db", str(target), "--users", "6", "--orders", "9", "--anchor", "2026-01-02T03:04:05Z"])
    assert "6 users, 9 orders" in capsys.readouterr().out
    data = dump(target)
    assert len(data["users"]) == 6 and len(data["orders"]) == 9
    assert max(when(o[7]) for o in data["orders"]) <= when("2026-01-02T04:04:05Z")


def test_draws_are_deterministic_and_never_loop_forever() -> None:
    first = fake.person(fake.Draw(1, "user", 5))
    assert first == fake.person(fake.Draw(1, "user", 5)) != fake.person(fake.Draw(2, "user", 5))
    assert first.field("email") == first.email
    with pytest.raises(ValueError, match="unknown person field"):
        first.field("password")
    with pytest.raises(ValueError, match="no acceptable person"):
        fake.first_person(fake.Draw("x"), lambda person: True)
    assert fake.ascii_fold("Núñez Álvarez") == "nunezalvarez"
