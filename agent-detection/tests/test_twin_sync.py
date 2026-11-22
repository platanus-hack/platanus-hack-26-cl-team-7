"""The live sync: masked real rows reach the twin, the twin's own rows stay, copy on flag."""

import sqlite3
import threading
from collections.abc import Callable
from pathlib import Path

import pytest
from test_twin_support import POLICY_FILE, make_shop, make_twin

from demo import auth, db, store
from demo.db import SQL
from demo.masking import Row, load_policy, project
from demo.replica import Copied, Syncer
from demo.web import Call, Shop

Shops = tuple[Shop, Shop, Syncer]
ORDER_ROWS = ("order_items", "order_events")


@pytest.fixture
def shops(tmp_path: Path) -> Shops:
    real = make_shop(tmp_path)
    twin = make_twin(tmp_path, real)
    return real, twin, Syncer(real.db, twin.db, load_policy(POLICY_FILE))


def rows(shop: Shop, table: str) -> dict[int, Row]:
    with db.opened(shop.db) as conn:
        return {int(r["id"]): tuple(r) for r in conn.execute(SQL[table].select_all)}


def place(shop: Shop, user_id: int, cart: dict[int, int]) -> int:
    account = store.user(shop, str(user_id))
    assert account is not None
    order_id = store.place_order(shop, account, cart)
    assert order_id is not None
    return order_id


def execute(shop: Shop, sql: str, *params: object) -> None:
    with db.opened(shop.db) as conn:
        conn.execute(sql, params)


def signed_in(shop: Shop, token: str) -> sqlite3.Row | None:
    return auth.current_user(Call("GET", "/", {}, {}, {}, shop, {"session": token}))


def whole_orders(shop: Shop) -> None:
    """Every order's items add up to its total and its history starts with "placed"."""
    with db.opened(shop.db) as conn:
        for order in conn.execute("SELECT id, total_cents FROM orders"):
            items = conn.execute(
                "SELECT coalesce(sum(quantity * price_cents), 0) FROM order_items"
                " WHERE order_id = ?",
                (order["id"],),
            ).fetchone()[0]
            first = conn.execute(
                "SELECT status FROM order_events WHERE order_id = ? ORDER BY id", (order["id"],)
            ).fetchone()
            assert items == order["total_cents"] and first["status"] == "placed", order["id"]


def test_sync_needs_an_existing_twin_and_never_creates_one(tmp_path: Path) -> None:
    real = make_shop(tmp_path)
    with pytest.raises(FileNotFoundError, match="demo.mask"):
        Syncer(real.db, tmp_path / "none.db", load_policy(POLICY_FILE))
    assert not (tmp_path / "none.db").exists()


def test_a_push_right_after_the_mask_changes_nothing(shops: Shops) -> None:
    assert shops[2].push() == {"inserted": 0, "updated": 0, "deleted": 0}


def test_new_changed_and_removed_real_rows_reach_the_twin_masked(shops: Shops) -> None:
    real, twin, syncer = shops
    order_id = place(real, 5, {2: 1, 3: 2})
    assert syncer.push() == {"inserted": 4, "updated": 0, "deleted": 0}
    mirrored = rows(twin, "orders")[order_id]
    masked_user, real_user = rows(twin, "users")[5], rows(real, "users")[5]
    assert (mirrored[4], mirrored[5]) == (masked_user[2], masked_user[5])
    assert mirrored[4] != real_user[2] and mirrored[5] != real_user[5]
    execute(real, "UPDATE orders SET status = 'paid' WHERE id = ?", order_id)
    execute(real, "UPDATE users SET avatar_url = 'https://cdn.example.com/x.png' WHERE id = 5")
    execute(real, "DELETE FROM order_events WHERE order_id = ?", order_id)
    assert syncer.push() == {"inserted": 0, "updated": 1, "deleted": 1}
    assert rows(twin, "orders")[order_id][2] == "paid" and rows(twin, "users")[5][8] is None
    assert syncer.push() == {"inserted": 0, "updated": 0, "deleted": 0}


def test_an_agent_order_on_the_twin_keeps_its_ids_and_hides_the_real_order(shops: Shops) -> None:
    real, twin, syncer = shops
    agent = place(twin, 3, {1: 1})
    invoice = store.invoice(twin, agent)
    hidden = place(real, 5, {4: 1})
    assert hidden == agent
    assert syncer.push() == {"inserted": 0, "updated": 0, "deleted": 0}
    assert store.invoice(twin, agent) == invoice
    shown = place(real, 6, {5: 1})
    assert syncer.push()["inserted"] == 3 and store.invoice(twin, shown) is not None
    whole_orders(twin)
    bigger = place(twin, 3, {1: 1, 2: 1, 3: 1})
    place(real, 7, {6: 1})
    later = place(real, 8, {7: 1})
    syncer.push()
    assert rows(twin, "orders")[bigger][1] == 3
    assert later not in rows(twin, "orders"), "its item ids are held by the agent's order"
    whole_orders(twin)
    assert syncer.push() == {"inserted": 0, "updated": 0, "deleted": 0}


def test_rows_the_twin_changed_or_deleted_stay_as_the_twin_has_them(shops: Shops) -> None:
    real, twin, syncer = shops
    execute(twin, "UPDATE users SET avatar_url = 'http://cb.example.net/a.png' WHERE id = 4")
    execute(twin, "DELETE FROM order_events WHERE id = 1")
    execute(real, "UPDATE users SET role = 'support' WHERE id = 4")
    execute(real, "UPDATE order_events SET at = '2026-01-01T00:00:00Z' WHERE id = 1")
    execute(twin, "INSERT INTO products VALUES (99, 'Twin Tea', 'x', 100, 1, '2026-11-01')")
    execute(real, "INSERT INTO products VALUES (99, 'Real Tea', 'y', 200, 2, '2026-11-01')")
    assert syncer.push() == {"inserted": 0, "updated": 0, "deleted": 0}
    assert rows(twin, "products")[99][1] == "Twin Tea"
    kept = rows(twin, "users")[4]
    assert (kept[6], kept[8]) == ("customer", "http://cb.example.net/a.png")
    assert 1 not in rows(twin, "order_events")
    execute(real, "DELETE FROM order_events WHERE id = 1")
    assert syncer.push() == {"inserted": 0, "updated": 0, "deleted": 0}


def account_rows(shop: Shop, user_id: int) -> dict[str, list[Row]]:
    """The user row and the user's orders, order items and order history."""
    orders = {i for i, row in rows(shop, "orders").items() if row[1] == user_id}
    return {
        "users": [rows(shop, "users")[user_id]],
        "orders": [rows(shop, "orders")[i] for i in sorted(orders)],
        **{t: [r for r in rows(shop, t).values() if r[1] in orders] for t in ORDER_ROWS},
    }


def login(shop: Shop) -> str:
    result = auth.login(shop, "alice", "wonderland")
    assert result is not None
    return result.token


def test_copy_brings_the_session_and_own_account_masked_as_the_push_masks_it(
    shops: Shops,
) -> None:
    real, twin, syncer = shops
    token = login(real)
    assert signed_in(twin, token) is None
    own = account_rows(real, 2)
    assert syncer.copy(f"cart=1:2; session={token}") == Copied(2, len(own["orders"]))
    masked = project(real.db, syncer.policy).tables
    assert account_rows(twin, 2) == {t: [masked[t][r[0]] for r in rs] for t, rs in own.items()}
    assert own["orders"] and account_rows(twin, 2) != own
    account = signed_in(twin, token)
    assert account is not None and account["username"] == masked["users"][2][1] != "alice"
    assert syncer.push() == {"inserted": 0, "updated": 0, "deleted": 0}
    assert rows(twin, "users")[2] == masked["users"][2]


def test_a_second_copy_keeps_what_the_agent_changed_on_the_twin(shops: Shops) -> None:
    real, twin, syncer = shops
    token = login(real)
    syncer.copy(token)
    execute(twin, "UPDATE users SET avatar_url = 'http://cb.example.net/me.png' WHERE id = 2")
    execute(twin, "DELETE FROM sessions")
    assert syncer.copy(f"session={token}") is not None
    assert signed_in(twin, token) is not None
    assert rows(twin, "users")[2][8] == "http://cb.example.net/me.png"


def test_new_real_orders_of_a_copied_account_reach_the_twin_masked(shops: Shops) -> None:
    real, twin, syncer = shops
    syncer.copy(login(real))
    order = place(real, 2, {1: 1})
    assert syncer.push() == {"inserted": 3, "updated": 0, "deleted": 0}
    masked = rows(twin, "users")[2]
    assert rows(twin, "orders")[order][4:6] == (masked[2], masked[5])
    assert syncer.push() == {"inserted": 0, "updated": 0, "deleted": 0}


def test_new_real_orders_of_an_account_the_agent_changed_stay_out_of_the_twin(
    shops: Shops,
) -> None:
    real, twin, syncer = shops
    syncer.copy(login(real))
    execute(twin, "UPDATE users SET avatar_url = 'http://cb.example.net/me.png' WHERE id = 2")
    copied = account_rows(twin, 2)
    owner_elsewhere = place(real, 2, {1: 1})
    other = place(real, 5, {2: 1})
    assert syncer.push() == {"inserted": 3, "updated": 0, "deleted": 0}
    assert account_rows(twin, 2) == copied and owner_elsewhere not in rows(twin, "orders")
    assert rows(twin, "orders")[other][1] == 5
    agent = place(twin, 2, {3: 1})
    assert agent == other + 1 and str(copied["users"][0][2]) in str(store.invoice(twin, agent))
    whole_orders(twin)


def test_copy_skips_an_order_whose_id_the_twin_holds(shops: Shops) -> None:
    real, twin, syncer = shops
    agent = place(twin, 3, {1: 1})
    clash = place(real, 2, {9: 2})
    assert clash == agent
    own = [o for o, row in rows(real, "orders").items() if row[1] == 2]
    copied = syncer.copy(login(real))
    assert copied == Copied(2, len(own) - 1)
    assert rows(twin, "orders")[agent][1] == 3
    whole_orders(twin)


@pytest.mark.parametrize("cookie", ["", "  ", "session=unknown", "cart=1:2"])
def test_copy_of_an_unknown_session_does_nothing(shops: Shops, cookie: str) -> None:
    before = rows(shops[1], "users")
    assert shops[2].copy(cookie) is None
    assert rows(shops[1], "users") == before


def test_copy_of_a_session_whose_user_is_gone_does_nothing(shops: Shops) -> None:
    real, _, syncer = shops
    execute(real, "INSERT INTO sessions VALUES ('orphan', 99999, '2026-11-01T00:00:00Z')")
    assert syncer.copy("orphan") is None


def test_a_failed_push_writes_nothing_and_the_next_one_recovers(
    shops: Shops, monkeypatch: pytest.MonkeyPatch
) -> None:
    real, twin, syncer = shops
    execute(real, "UPDATE products SET price_cents = 999 WHERE id = 1")
    place(real, 5, {1: 1})
    original: Callable[..., object] = Syncer._push_table

    def failing(self: Syncer, conn: sqlite3.Connection, table: str, *rest: object) -> object:
        if table == "orders":
            raise sqlite3.OperationalError("disk I/O error")
        return original(self, conn, table, *rest)

    monkeypatch.setattr(Syncer, "_push_table", failing)
    with pytest.raises(sqlite3.OperationalError):
        syncer.push()
    assert rows(twin, "products")[1][3] != 999
    monkeypatch.undo()
    assert syncer.push() == {"inserted": 3, "updated": 1, "deleted": 0}
    assert rows(twin, "products")[1][3] == 999


def test_push_copy_and_both_shops_can_write_at_the_same_time(shops: Shops) -> None:
    real, twin, syncer = shops
    token = login(real)
    errors: list[BaseException] = []

    def repeat(work: Callable[[], object], times: int) -> Callable[[], None]:
        def run() -> None:
            try:
                for _ in range(times):
                    work()
            except BaseException as exc:  # reported to the test thread below
                errors.append(exc)

        return run

    jobs = [
        repeat(syncer.push, 6),
        repeat(syncer.push, 6),
        repeat(lambda: syncer.copy(token), 6),
        repeat(lambda: place(twin, 3, {1: 1, 2: 1}), 6),
        repeat(lambda: place(real, 5, {3: 1}), 6),
        repeat(lambda: login(twin) if signed_in(twin, token) else None, 6),
    ]
    threads = [threading.Thread(target=job) for job in jobs]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    syncer.push()
    assert syncer.push() == {"inserted": 0, "updated": 0, "deleted": 0}
    whole_orders(twin)
    assert sum(row[1] == 3 for row in rows(twin, "orders").values()) >= 6
