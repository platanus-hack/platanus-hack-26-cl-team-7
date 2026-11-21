"""mirror.keys: the key table (idle expiry per kind, no take-over, LRU cap, JSONL persistence)."""

from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path

import pytest

from mirror import keys as k
from mirror.contracts import TrackKey
from mirror.keys import HOUR, KeyTable, twin_born_key

T1 = "trk_00000000000000a1"
T2 = "trk_00000000000000b2"
IP = TrackKey("ip", "203.0.113.7")
IP_UA = TrackKey("ip_ua", "203.0.113.7|python-httpx/0.27.0")
START = 1_763_700_000.0


class Clock:
    def __init__(self, now: float = START) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


def table(path: Path, clock: Clock, **options: int) -> KeyTable:
    return KeyTable.load(path, clock=clock, **options)


def test_twin_born_key_hashes_the_value_and_refuses_short_ones() -> None:
    key = twin_born_key("sess-4821ab")
    assert key == TrackKey("twin_born", hashlib.sha256(b"sess-4821ab").hexdigest())
    assert twin_born_key("x" * (k.MIN_TWIN_BORN_LEN - 1)) is None


def test_bind_then_find_returns_the_first_bound_key(tmp_path: Path, clock: Clock) -> None:
    keys = table(tmp_path / "keys.jsonl", clock)
    assert keys.find([IP_UA, IP]) is None
    assert keys.bind(IP, T1) is True
    assert keys.find([IP_UA, IP]) == (T1, IP)
    assert keys.bind(IP_UA, T1) is True
    assert keys.find([IP_UA, IP]) == (T1, IP_UA)
    assert len(keys) == 2


def test_bind_never_takes_a_key_from_another_track(tmp_path: Path, clock: Clock) -> None:
    keys = table(tmp_path / "keys.jsonl", clock)
    assert keys.bind(IP_UA, T1) is True
    assert keys.bind(IP_UA, T1) is False
    assert keys.bind(IP_UA, T2) is False
    assert keys.find([IP_UA]) == (T1, IP_UA)


def test_each_kind_expires_after_its_own_idle_time(tmp_path: Path, clock: Clock) -> None:
    keys = table(tmp_path / "keys.jsonl", clock)
    twin = twin_born_key("token-abcdef")
    assert twin is not None
    for key in (IP, IP_UA, twin):
        keys.bind(key, T1)
    clock.now += HOUR + 1
    assert keys.find([IP]) is None
    assert keys.find([IP_UA]) == (T1, IP_UA)
    clock.now += 24 * HOUR + 1
    assert keys.find([IP_UA]) is None
    assert keys.find([twin]) is None
    assert len(keys) == 0
    assert keys.bind(IP, T2) is True  # an expired key is free again


def test_use_restarts_the_idle_time(tmp_path: Path, clock: Clock) -> None:
    keys = table(tmp_path / "keys.jsonl", clock)
    keys.bind(IP, T1)
    for _ in range(3):
        clock.now += HOUR - 1
        assert keys.find([IP]) == (T1, IP)
    clock.now += HOUR + 1
    assert keys.find([IP]) is None


def test_find_touches_every_bound_key_not_only_the_first(tmp_path: Path, clock: Clock) -> None:
    keys = table(tmp_path / "keys.jsonl", clock)
    keys.bind(IP_UA, T1)
    keys.bind(IP, T1)
    clock.now += HOUR - 1
    assert keys.find([IP_UA, IP]) == (T1, IP_UA)
    clock.now += HOUR - 1
    assert keys.find([IP]) == (T1, IP)


def test_cap_evicts_the_least_recently_used_key(tmp_path: Path, clock: Clock) -> None:
    keys = table(tmp_path / "keys.jsonl", clock, max_per_kind=2)
    a, b, c = (TrackKey("ip", f"198.51.100.{n}") for n in (1, 2, 3))
    keys.bind(a, T1)
    clock.now += 1
    keys.bind(b, T1)
    clock.now += 1
    assert keys.find([a]) == (T1, a)
    keys.bind(c, T1)
    assert keys.find([b]) is None
    assert keys.find([a]) == (T1, a)
    assert keys.find([c]) == (T1, c)


def test_reload_restores_live_keys_drops_expired_and_compacts(tmp_path: Path, clock: Clock) -> None:
    path = tmp_path / "keys.jsonl"
    keys = table(path, clock)
    keys.bind(IP, T1)
    keys.bind(IP_UA, T2)
    keys.close()
    clock.now += HOUR + 1
    again = table(path, clock)
    records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert [(r["kind"], r["track"]) for r in records] == [("ip_ua", T2)]
    assert again.find([IP]) is None
    assert again.find([IP_UA]) == (T2, IP_UA)


def test_use_is_persisted_at_most_every_touch_interval(tmp_path: Path, clock: Clock) -> None:
    path = tmp_path / "keys.jsonl"
    keys = table(path, clock)
    keys.bind(IP, T1)
    clock.now += k.TOUCH_PERSIST / 2
    keys.find([IP])
    assert len(path.read_text(encoding="utf-8").splitlines()) == 1
    clock.now += k.TOUCH_PERSIST
    keys.find([IP])
    assert len(path.read_text(encoding="utf-8").splitlines()) == 2
    keys.close()
    clock.now += HOUR - 1  # past the bind's idle time, within the persisted use's
    assert table(path, clock).find([IP]) == (T1, IP)


def test_journal_never_holds_the_raw_value(tmp_path: Path, clock: Clock) -> None:
    path = tmp_path / "keys.jsonl"
    keys = table(path, clock)
    twin = twin_born_key("alice.secret-session@example.com")
    assert twin is not None
    keys.bind(twin, T1)
    keys.bind(IP_UA, T1)
    text = path.read_text(encoding="utf-8")
    assert "alice" not in text
    assert twin.value not in text
    assert "python-httpx" not in text


def test_reload_skips_bad_records_and_keeps_the_newest_of_duplicates(
    tmp_path: Path, clock: Clock
) -> None:
    path = tmp_path / "keys.jsonl"
    good = {"kind": "ip", "digest": k.digest(IP).hex(), "track": T1, "seen": START}
    newer = {**good, "track": T2, "seen": START + 5}
    bad = [
        {**good, "kind": "cookie"},
        {**good, "kind": ["ip"]},
        {**good, "digest": "zz"},
        {**good, "track": "trk_short"},
        {**good, "seen": "yesterday"},
        {**good, "seen": True},
    ]
    lines = [json.dumps(record) for record in (newer, good, *bad)]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    keys = table(path, clock)
    assert keys.find([IP]) == (T2, IP)
    assert len(keys) == 1


def test_reload_applies_the_cap_keeping_the_newest(tmp_path: Path, clock: Clock) -> None:
    path = tmp_path / "keys.jsonl"
    keys = table(path, clock)
    old, new = TrackKey("ip", "198.51.100.1"), TrackKey("ip", "198.51.100.2")
    keys.bind(old, T1)
    clock.now += 1
    keys.bind(new, T2)
    keys.close()
    capped = table(path, clock, max_per_kind=1)
    assert capped.find([old]) is None
    assert capped.find([new]) == (T2, new)


def test_journal_is_compacted_while_running(tmp_path: Path, clock: Clock) -> None:
    path = tmp_path / "keys.jsonl"
    keys = table(path, clock, max_per_kind=10)
    binds = k.COMPACT_RATIO * 10 + k.COMPACT_SLACK + 5
    for n in range(binds):
        keys.bind(TrackKey("ip_ua", f"198.51.100.1|agent-{n}"), T1)
    lines = len(path.read_text(encoding="utf-8").splitlines())
    assert lines < k.COMPACT_SLACK
    assert len(keys) == 10


def test_concurrent_binds_of_one_key_make_exactly_one_new_binding(
    tmp_path: Path, clock: Clock
) -> None:
    keys = table(tmp_path / "keys.jsonl", clock)
    results: list[bool] = []
    barrier = threading.Barrier(8)

    def bind(track: str) -> None:
        barrier.wait()
        results.append(keys.bind(IP_UA, track))

    pool = [threading.Thread(target=bind, args=(f"trk_{n:016x}",)) for n in range(8)]
    for thread in pool:
        thread.start()
    for thread in pool:
        thread.join()
    assert results.count(True) == 1
