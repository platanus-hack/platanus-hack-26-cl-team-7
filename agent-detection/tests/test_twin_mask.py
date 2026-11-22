"""The one-way mask: the twin gets only what config/mask.yaml lets through, and canaries."""

import json
from dataclasses import replace
from pathlib import Path

import pytest
from test_twin_support import POLICY_FILE, make_shop

from demo import db, fake
from demo.db import SQL
from demo.mask import CANARIES_VERSION, main, mask
from demo.masking import PUBLIC, Masked, Policy, load_policy
from demo.web import Shop

Dump = dict[str, list[dict[str, object]]]
# Where each kind of private value lives in the real data.
PRIVATE = {
    "name": (("users", "name"), ("orders", "ship_name")),
    "username": (("users", "username"),),
    "email": (("users", "email"),),
    "phone": (("users", "phone"),),
    "address": (("users", "address"), ("orders", "ship_address")),
}
SECRET_WORDS = ("secret", "key", "token", "password", "hash", "api")


def dump(path: Path) -> Dump:
    with db.opened(path) as conn:
        tables = {t: [dict(r) for r in conn.execute(sql.select_all)] for t, sql in SQL.items()}
        tables["sessions"] = [dict(r) for r in conn.execute("SELECT * FROM sessions")]
    return tables


@pytest.fixture(scope="module")
def folder(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("mask")
    real = make_shop(path)
    with db.opened(real.db) as conn:
        conn.execute("INSERT INTO sessions VALUES ('real-session', 2, '2026-11-01T00:00:00Z')")
        conn.execute("UPDATE users SET avatar_url = 'https://cdn.example.com/a.png' WHERE id = 2")
    mask(real.db, path / "twin.db", load_policy(POLICY_FILE), path / "canaries.json")
    return path


@pytest.fixture(scope="module")
def real(folder: Path) -> Dump:
    return dump(folder / "real.db")


@pytest.fixture(scope="module")
def twin(folder: Path) -> Dump:
    return dump(folder / "twin.db")


def values(data: Dump, kind: str) -> set[object]:
    return {row[col] for table, col in PRIVATE[kind] for row in data[table]}


def test_public_columns_copy_and_unlisted_ones_are_empty(real: Dump, twin: Dump) -> None:
    assert twin["products"] == real["products"] and twin["sessions"] == []
    for table in ("orders", "order_items", "order_events"):
        assert [r["id"] for r in twin[table]] == [r["id"] for r in real[table]]
    for table in ("order_items", "order_events"):
        assert twin[table] == real[table]
    for theirs, ours in zip(real["users"], twin["users"], strict=True):
        assert (ours["id"], ours["role"], ours["created_at"]) == (
            theirs["id"],
            theirs["role"],
            theirs["created_at"],
        )
        assert ours["password_hash"] is None and ours["avatar_url"] is None


def test_masked_values_are_realistic_unique_and_never_a_real_value(real: Dump, twin: Dump) -> None:
    every_real_text = {v for rows in real.values() for row in rows for v in row.values()}
    for kind in PRIVATE:
        masked = values(twin, kind)
        assert masked and masked.isdisjoint(values(real, kind)), kind
        assert masked.isdisjoint(every_real_text), kind
    for unique in ("username", "email"):
        column = [row[unique] for row in twin["users"]]
        assert len(set(column)) == len(column)
    for user in twin["users"]:
        assert str(user["email"]).endswith(fake.EMAIL_DOMAINS) and " " in str(user["name"])
        assert str(user["phone"]).startswith(fake.PHONE_PREFIX)


def test_one_person_has_the_same_masked_values_in_every_table(twin: Dump) -> None:
    people = {u["id"]: u for u in twin["users"]}
    for order in twin["orders"]:
        owner = people[order["user_id"]]
        assert (order["ship_name"], order["ship_address"]) == (owner["name"], owner["address"])


def test_the_mask_is_deterministic_and_never_writes_the_real_file(folder: Path) -> None:
    real_bytes = (folder / "real.db").read_bytes()
    canaries = (folder / "canaries.json").read_text()
    again = folder / "again"
    mask(folder / "real.db", again / "twin.db", load_policy(POLICY_FILE), again / "c.json")
    assert dump(again / "twin.db") == dump(folder / "twin.db")
    assert (again / "c.json").read_text() == canaries
    assert (folder / "real.db").read_bytes() == real_bytes
    with pytest.raises(ValueError, match="another file"):
        mask(folder / "real.db", folder / "real.db", load_policy(POLICY_FILE), again / "c.json")


def test_canaries_are_ordinary_private_values_only_the_twin_holds(
    folder: Path, real: Dump, twin: Dump
) -> None:
    document = json.loads((folder / "canaries.json").read_text())
    assert document["version"] == CANARIES_VERSION
    canaries = document["canaries"]
    kinds = {c["kind"] for c in canaries}
    assert {"admin_email", "admin_phone", "admin_address", "order_address"} <= kinds
    admin = next(u for u in twin["users"] if u["role"] == "admin")
    newest = max(twin["orders"], key=lambda o: str(o["created_at"]))
    found = {c["value"] for c in canaries}
    assert {admin["email"], admin["phone"], admin["address"], newest["ship_address"]} <= found
    assert len(found) == len(canaries), "one canary per value"
    real_text = (folder / "real.db").read_bytes()
    for canary in canaries:
        row = next(r for r in twin[canary["table"]] if r["id"] == canary["rowId"])
        assert row[canary["column"]] == canary["value"]
        assert canary["value"].encode() not in real_text
        assert not any(word in canary["kind"] for word in SECRET_WORDS)
        assert not any(word in canary["column"] for word in SECRET_WORDS)


def test_an_unlisted_column_or_table_stays_empty_in_the_twin(folder: Path) -> None:
    policy = load_policy(POLICY_FILE)
    users = {c: r for c, r in policy.tables["users"].items() if c != "phone"}
    tables = {t: r for t, r in policy.tables.items() if t != "order_events"}
    narrow = replace(policy, tables={**tables, "users": users}, recent_orders=0)
    out = folder / "narrow"
    mask(folder / "real.db", out / "twin.db", narrow, out / "c.json")
    data = dump(out / "twin.db")
    assert data["order_events"] == [] and {u["phone"] for u in data["users"]} == {None}
    kinds = {c["kind"] for c in json.loads((out / "c.json").read_text())["canaries"]}
    assert kinds == {"admin_email", "admin_address"}


def write_policy(folder: Path, tables: str) -> Path:
    path = folder / "policy.yaml"
    path.write_text(f"key: k\ntables:\n{tables}", encoding="utf-8")
    return path


@pytest.mark.parametrize(
    ("tables", "message"),
    [
        ("  wallets:\n    id: public\n", "unknown or lacks"),
        ("  users:\n    name: public\n", "unknown or lacks"),
        ("  users:\n    id: public\n    name: copy\n", "expected 'public'"),
        ("  users:\n    id: public\n    name: {mask: password, person: id}\n", "expected"),
        ("  users:\n    id: public\n    name: {mask: name, person: email}\n", "expected"),
    ],
)
def test_a_bad_allow_list_is_refused(tmp_path: Path, tables: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        load_policy(write_policy(tmp_path, tables))


def test_an_allow_list_naming_a_missing_column_is_refused(tmp_path: Path) -> None:
    real = make_shop(tmp_path, proxy=None)
    policy = load_policy(write_policy(tmp_path, "  users:\n    id: public\n    shoe: public\n"))
    assert policy.tables["users"] == {"id": PUBLIC, "shoe": PUBLIC} and policy.recent_orders == 0
    with pytest.raises(ValueError, match="no such columns"):
        mask(real.db, tmp_path / "twin.db", policy, tmp_path / "c.json")
    assert not (tmp_path / "twin.db").exists()


def test_the_config_masks_every_private_people_column() -> None:
    policy = load_policy(POLICY_FILE)
    assert isinstance(policy, Policy) and policy.admin_role == "admin"
    for kind, places in PRIVATE.items():
        for table, column in places:
            rule = policy.tables[table][column]
            assert isinstance(rule, Masked) and rule.kind == kind
    assert "password_hash" not in policy.tables["users"]
    assert "sessions" not in policy.tables


def test_main_writes_the_twin_and_canaries_next_to_it(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    real: Shop = make_shop(tmp_path)
    twin = tmp_path / "run" / "twin.db"
    main(["--from", str(real.db), "--to", str(twin), "--allow", str(POLICY_FILE)])
    assert (tmp_path / "run" / "canaries.json").is_file()
    assert "masked" in capsys.readouterr().out
