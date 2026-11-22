"""Copy on flag keeps the agent signed in on the twin without putting a real private value there:
the account goes through the allow list as the nightly mask writes it, the session row is the
only real value, and the twin's own SQL cannot read it."""

import sqlite3
from pathlib import Path

import pytest
from test_twin_support import POLICY_FILE, make_shop, make_twin
from test_twin_sync import account_rows, execute, login, place, rows, signed_in

from demo import auth, db
from demo.masking import load_policy, project
from demo.replica import Syncer
from demo.web import Shop

Shops = tuple[Shop, Shop, Syncer]
USERS = "SELECT id, username, name, email, phone, address, password_hash FROM users"
STEAL = "x' UNION SELECT 1, hex(token), 0, 0, 0, 0, 'u', 0, 0, 0 FROM sessions --"


@pytest.fixture
def shops(tmp_path: Path) -> Shops:
    real = make_shop(tmp_path)
    twin = make_twin(tmp_path, real)
    return real, twin, Syncer(real.db, twin.db, load_policy(POLICY_FILE))


def private_values(shop: Shop) -> set[str]:
    """Every private value of every account of the real shop, orders' ship-to included."""
    with db.opened(shop.db) as conn:
        found = {str(v) for row in conn.execute(USERS) for v in row[1:] if v is not None}
        ships = conn.execute("SELECT ship_name, ship_address FROM orders")
        found |= {str(v) for row in ships for v in row}
    return found


def everything(shop: Shop) -> list[str]:
    """Every value in every table of the shop's database, as text."""
    with db.opened(shop.db) as conn:
        names = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
        return [str(v) for n in names for row in conn.execute(f"SELECT * FROM {n}") for v in row]


def test_the_twin_holds_no_real_private_value_after_a_copy(shops: Shops) -> None:
    real, twin, syncer = shops
    execute(real, "UPDATE users SET avatar_url = 'https://cdn.example.com/alice.png' WHERE id = 2")
    token = login(real)
    assert syncer.copy(f"session={token}") is not None
    held = everything(twin)
    assert not private_values(real) & set(held)
    assert not [v for v in held if "liddell" in v.lower()]
    mine = rows(twin, "users")[2]
    assert (mine[7], mine[8]) == (None, None), "no password hash, no picture"
    assert all(mine[i] for i in range(1, 6)), "but a made-up person"
    assert token in held and not [t for t in held if t == auth.password_hash("wonderland")]


def test_a_copy_writes_what_the_nightly_mask_writes(shops: Shops, tmp_path: Path) -> None:
    real, twin, syncer = shops
    nightly = make_twin(tmp_path / "nightly", real)
    syncer.copy(login(real))
    assert account_rows(twin, 2) == account_rows(nightly, 2)


def test_the_copied_agent_stays_signed_in_with_the_one_session_row(shops: Shops) -> None:
    real, twin, syncer = shops
    token = login(real)
    execute(real, "INSERT INTO sessions VALUES ('someone-elses-token', 1, '2026-11-01T00:00:00Z')")
    syncer.copy(f"cart=1:2; session={token}")
    with db.opened(real.db) as conn:
        own = tuple(conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone())
    with db.opened(twin.db) as conn:
        assert [tuple(r) for r in conn.execute("SELECT * FROM sessions")] == [own]
    account = signed_in(twin, token)
    assert account is not None and account["id"] == 2
    assert account["email"] != "alice.liddell@gmail.com"
    assert signed_in(twin, "someone-elses-token") is None


def test_the_twin_sql_cannot_read_the_session_table_so_no_other_agent_can_take_the_token(
    shops: Shops,
) -> None:
    real, twin, syncer = shops
    syncer.copy(login(real))
    for shop in (twin, real):
        with pytest.raises(sqlite3.DatabaseError, match="prohibited"):
            auth.login(shop, STEAL, "p")
        with db.injectable(shop.db) as conn, pytest.raises(sqlite3.DatabaseError):
            conn.execute("SELECT token FROM Sessions").fetchall()
        with db.injectable(shop.db) as conn:
            assert conn.execute("SELECT count(*) FROM users").fetchone()[0] > 0


def test_the_copied_agent_cannot_sign_in_with_the_real_password_on_the_twin(shops: Shops) -> None:
    real, twin, syncer = shops
    syncer.copy(login(real))
    masked = str(rows(twin, "users")[2][1])
    assert auth.login(twin, masked, "wonderland") is None
    assert auth.login(twin, "alice", "wonderland") is None
    assert auth.login(real, "alice", "wonderland") is not None


def test_a_user_registered_after_the_mask_is_copied_masked_too(shops: Shops) -> None:
    real, twin, syncer = shops
    new = "INSERT INTO users VALUES (31, 'mara.quint', 'Mara Quint', 'mara.quint@example.net', "
    execute(real, new + "'+56 9 1111 2222', 'Calle Nueva 5, Arica', 'customer', 'h4sh', NULL, 'x')")
    session = "'mara-token-0123456789', 31, '2026-11-01T00:00:00Z'"
    execute(real, f"INSERT INTO sessions VALUES ({session})")
    place(real, 31, {1: 1})
    assert syncer.copy("session=mara-token-0123456789") is not None
    held = everything(twin)
    private = {"mara.quint", "Mara Quint", "mara.quint@example.net", "h4sh", "Calle Nueva 5, Arica"}
    assert not private & set(held)
    account = signed_in(twin, "mara-token-0123456789")
    assert account is not None and account["username"] not in ("mara.quint", None)
    assert syncer.push() == {"inserted": 0, "updated": 0, "deleted": 0}


def test_copying_the_same_session_twice_changes_nothing(shops: Shops) -> None:
    real, twin, syncer = shops
    token = login(real)
    syncer.copy(token)
    before = everything(twin)
    assert syncer.copy(f"session={token}") is not None and everything(twin) == before
    assert syncer.push() == {"inserted": 0, "updated": 0, "deleted": 0}


def test_account_rows_follow_the_tables_the_policy_lists(shops: Shops, tmp_path: Path) -> None:
    real, twin, syncer = shops
    full = project(real.db, syncer.policy).account(2)
    assert set(full) == {"users", "orders", "order_items", "order_events"}
    assert set(full["users"]) == {2} and full["orders"] and full["order_items"]
    users_only = tmp_path / "users-only.yaml"
    users_only.write_text(
        "key: k\ntables:\n  users:\n    id: public\n    role: public\n    username: public\n"
    )
    narrow = project(real.db, load_policy(users_only)).account(2)
    assert set(narrow) == {"users"} and set(narrow["users"]) == {2}
    assert project(real.db, syncer.policy).account(999)["users"] == {}
    products_only = tmp_path / "products-only.yaml"
    products_only.write_text("key: k\ntables:\n  products:\n    id: public\n    name: public\n")
    assert project(real.db, load_policy(products_only)).account(2) == {}
    assert Syncer(real.db, twin.db, load_policy(products_only)).copy(login(real)) is None
