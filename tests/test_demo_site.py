"""Acceptance tests for the stand-in demo shop (`python -m demo --port N`)."""

import http.client
import re
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
ROUTES_YAML = ROOT / "config" / "routes.yaml"
HOST = "127.0.0.1"
STARTUP_TIMEOUT = 10.0
MAX_CRAWL_PAGES = 60
LINK_ATTRS = {"a": "href", "link": "href", "script": "src", "img": "src"}
FIXED_UNKNOWN = ("/zz-unknown-9f3a", "/.env", "/.git/config", "/wp-login.php", "/admin/zz-unknown")


@dataclass(frozen=True)
class Reply:
    status: int
    content_type: str
    body: bytes


class LinkCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        wanted = LINK_ATTRS.get(tag)
        for name, value in attrs:
            if name == wanted and value:
                self.links.append(value)


def load_routes() -> list[dict[str, Any]]:
    data = yaml.safe_load(ROUTES_YAML.read_text(encoding="utf-8"))
    routes: list[dict[str, Any]] = data["routes"]
    return routes


def pattern_regex(pattern: str) -> re.Pattern[str]:
    wildcard = pattern.endswith("/**")
    base = pattern[: -len("/**")] if wildcard else pattern
    parts = [
        r"[^/]+" if re.fullmatch(r"\{[^/{}]+\}", seg) else re.escape(seg) for seg in base.split("/")
    ]
    body = "/".join(parts)
    return re.compile(body + (r"(/.*)?" if wildcard else "") + r"\Z")


def normalize(path: str) -> str:
    return path.rstrip("/") or "/"


def matches_any(path: str, routes: list[dict[str, Any]]) -> bool:
    target = normalize(path)
    return any(pattern_regex(normalize(r["pattern"])).match(target) for r in routes)


def instantiate(pattern: str) -> str:
    return re.sub(r"\{[^/{}]+\}", "1", pattern)


def methods_of(route: dict[str, Any]) -> list[str]:
    methods: list[str] = route.get("methods") or ["GET"]
    return [m.upper() for m in methods]


def request(base: str, method: str, path: str, form: dict[str, str] | None = None) -> Reply:
    parts = urlsplit(base)
    conn = http.client.HTTPConnection(parts.hostname or HOST, parts.port, timeout=5)
    body = urlencode(form).encode() if form is not None else None
    headers = {"Content-Type": "application/x-www-form-urlencoded"} if form is not None else {}
    try:
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        return Reply(resp.status, resp.getheader("Content-Type") or "", resp.read())
    finally:
        conn.close()


def internal_links(html: bytes) -> list[str]:
    collector = LinkCollector()
    collector.feed(html.decode("utf-8", errors="replace"))
    paths: list[str] = []
    for link in collector.links:
        parts = urlsplit(link)
        if parts.scheme or parts.netloc or not parts.path.startswith("/"):
            continue
        paths.append(parts.path)
    return paths


def is_html(reply: Reply) -> bool:
    return reply.content_type.lower().startswith("text/html")


def crawl(base: str, start: str = "/") -> dict[str, Reply]:
    seen: dict[str, Reply] = {}
    queue = [start]
    while queue and len(seen) < MAX_CRAWL_PAGES:
        path = queue.pop(0)
        if path in seen:
            continue
        reply = request(base, "GET", path)
        seen[path] = reply
        if reply.status == 200 and is_html(reply):
            queue.extend(p for p in internal_links(reply.body) if p not in seen)
    return seen


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((HOST, 0))
        port: int = sock.getsockname()[1]
        return port


def wait_until_listening(proc: subprocess.Popen[bytes], port: int) -> None:
    deadline = time.monotonic() + STARTUP_TIMEOUT
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            stderr = proc.stderr.read().decode() if proc.stderr else ""
            pytest.fail(f"demo site exited early with {proc.returncode}: {stderr}")
        try:
            with socket.create_connection((HOST, port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    pytest.fail(f"demo site did not listen on port {port} within {STARTUP_TIMEOUT}s")


@pytest.fixture(scope="module")
def base_url() -> Iterator[str]:
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "demo", "--port", str(port)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        wait_until_listening(proc, port)
        yield f"http://{HOST}:{port}"
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


@pytest.fixture(scope="module")
def routes() -> list[dict[str, Any]]:
    return load_routes()


@pytest.fixture(scope="module")
def crawled(base_url: str) -> dict[str, Reply]:
    return crawl(base_url)


def test_routes_file_declares_home_login_and_static(routes: list[dict[str, Any]]) -> None:
    patterns = {r["pattern"] for r in routes}
    assert "/" in patterns
    assert "/login" in patterns
    assert any(r["pattern"].endswith("/**") and r.get("asset") for r in routes)
    login = next(r for r in routes if r["pattern"] == "/login")
    assert "POST" in methods_of(login)


def test_every_concrete_route_answers_without_404(
    base_url: str, routes: list[dict[str, Any]]
) -> None:
    failures: list[str] = []
    for route in routes:
        if route["pattern"].endswith("/**"):
            continue
        path = instantiate(route["pattern"])
        for method in methods_of(route):
            form: dict[str, str] | None = {} if method in {"POST", "PUT", "PATCH"} else None
            reply = request(base_url, method, path, form)
            if reply.status == 404 or reply.status >= 500:
                failures.append(f"{method} {path} -> {reply.status}")
    assert failures == []


def test_wildcard_routes_have_linked_assets_that_resolve(
    base_url: str, routes: list[dict[str, Any]], crawled: dict[str, Reply]
) -> None:
    linked = set(crawled)
    for route in (r for r in routes if r["pattern"].endswith("/**")):
        prefix = route["pattern"][: -len("**")]
        under = sorted(p for p in linked if p.startswith(prefix))
        assert under, f"no page links to anything under {prefix}"
        for path in under:
            reply = request(base_url, "GET", path)
            assert reply.status == 200, f"{path} -> {reply.status}"
            assert reply.body, f"{path} returned an empty body"


def test_home_is_html_linking_pages_and_static_assets(base_url: str) -> None:
    reply = request(base_url, "GET", "/")
    assert reply.status == 200
    assert is_html(reply)
    links = set(internal_links(reply.body))
    pages = {p for p in links if not p.startswith("/static/") and normalize(p) != "/"}
    assert len(pages) >= 2, f"home links to too few pages: {sorted(pages)}"
    assert any(p.startswith("/static/") for p in links), "home links no /static asset"


def test_crawl_from_home_reaches_several_pages(crawled: dict[str, Reply]) -> None:
    html_pages = [p for p, r in crawled.items() if r.status == 200 and is_html(r)]
    assert len(html_pages) >= 3, f"crawl reached only {sorted(html_pages)}"
    pages_with_static = [
        p
        for p in html_pages
        if any(link.startswith("/static/") for link in internal_links(crawled[p].body))
    ]
    assert len(pages_with_static) >= 2


def test_every_crawled_link_is_on_the_route_list_and_resolves(
    crawled: dict[str, Reply], routes: list[dict[str, Any]]
) -> None:
    exits = sorted(p for p in crawled if not matches_any(p, routes))
    assert exits == [], f"pages link to off-contract paths: {exits}"
    broken = sorted(f"{p} -> {r.status}" for p, r in crawled.items() if r.status >= 400)
    assert broken == []


def test_static_assets_have_sensible_content_types(crawled: dict[str, Reply]) -> None:
    expected = {".css": "text/css", ".js": "javascript", ".png": "image/png", ".svg": "image/svg"}
    for path, reply in crawled.items():
        suffix = Path(path).suffix.lower()
        if path.startswith("/static/") and suffix in expected:
            assert expected[suffix] in reply.content_type.lower(), f"{path}: {reply.content_type}"


def unknown_candidates(routes: list[dict[str, Any]]) -> list[str]:
    literal = next(
        r["pattern"]
        for r in routes
        if r["pattern"] != "/" and "{" not in r["pattern"] and "**" not in r["pattern"]
    )
    param = [r["pattern"] for r in routes if "{" in r["pattern"]]
    nested = [instantiate(p) + "/zz-extra" for p in param]
    return [*FIXED_UNKNOWN, literal.upper(), literal + "/zz-unknown", *nested]


def test_unknown_paths_return_404(base_url: str, routes: list[dict[str, Any]]) -> None:
    candidates = [p for p in unknown_candidates(routes) if not matches_any(p, routes)]
    assert len(candidates) >= 5
    failures = []
    for path in candidates:
        for method in ("GET", "POST"):
            reply = request(base_url, method, path, {} if method == "POST" else None)
            if reply.status != 404:
                failures.append(f"{method} {path} -> {reply.status}")
    assert failures == []


def test_unknown_static_file_returns_404(base_url: str) -> None:
    reply = request(base_url, "GET", "/static/zz-missing-9f3a.css")
    assert reply.status == 404


def test_post_login_succeeds_with_form_credentials(base_url: str) -> None:
    form = {"username": "alice", "password": "wonderland"}
    reply = request(base_url, "POST", "/login", form)
    assert 200 <= reply.status < 400, f"POST /login -> {reply.status}"


def test_get_login_page_is_html(base_url: str) -> None:
    reply = request(base_url, "GET", "/login")
    assert reply.status == 200
    assert is_html(reply)


def test_query_strings_do_not_change_routing(base_url: str) -> None:
    assert request(base_url, "GET", "/?q=o%27brien").status == 200
    assert request(base_url, "GET", "/zz-unknown-9f3a?q=1").status == 404
