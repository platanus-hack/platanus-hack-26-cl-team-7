"""The route list: which (method, path) pairs the site serves on purpose."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

_PARAM = re.compile(r"\{[^/{}]+\}")
_WILDCARD = "/**"
_ENCODED_DOT_OR_SLASH = re.compile(r"%(2e|2f|5c)", re.IGNORECASE)
_DOT_SEGMENT = re.compile(r"(?:^|[/\\])\.{1,2}(?:[/\\]|$)")


@dataclass(frozen=True, slots=True)
class RouteMatch:
    pattern: str
    asset: bool


@dataclass(frozen=True, slots=True)
class _Route:
    match: RouteMatch
    regex: re.Pattern[str]
    methods: frozenset[str] | None

    def accepts(self, method: str, path: str) -> bool:
        if self.methods is not None and method not in self.methods:
            return False
        return self.regex.fullmatch(path) is not None


class RouteTable:
    def __init__(self, routes: Sequence[_Route]) -> None:
        self._routes = tuple(routes)

    @classmethod
    def from_yaml(cls, path: str | Path) -> RouteTable:
        return cls.from_patterns(load_route_entries(path))

    @classmethod
    def from_patterns(cls, patterns: Sequence[Mapping[str, Any]]) -> RouteTable:
        return cls([_compile(entry) for entry in patterns])

    def match(self, method: str, path: str) -> RouteMatch | None:
        """The route for (method, path), or None for an exit.

        A path with a "." or ".." segment (raw or %2e-encoded) is always an exit: browsers
        resolve dot segments before they send, and "/static/../admin" asks for /admin.
        """
        if has_dot_segment(path):
            return None
        target = _normalize(path)
        for route in self._routes:
            if route.accepts(method, target):
                return route.match
        return None


def load_route_entries(path: str | Path) -> list[Mapping[str, Any]]:
    """The checked entries of a routes.yaml file. Raises ValueError on a broken file.

    An empty or misspelled route list would turn every request into an exit, so it is an error.
    """
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    routes = data.get("routes") if isinstance(data, dict) else None
    if not isinstance(routes, list) or not routes:
        raise ValueError(f"{path}: needs a non-empty 'routes' list")
    for entry in routes:
        _check_entry(entry, path)
    return routes


def has_dot_segment(path: str) -> bool:
    probe = _ENCODED_DOT_OR_SLASH.sub(lambda m: chr(int(m.group(1), 16)), path)
    return _DOT_SEGMENT.search(probe) is not None


def _check_entry(entry: object, source: str | Path) -> None:
    if not isinstance(entry, Mapping):
        raise ValueError(f"{source}: route entry {entry!r} is not a mapping")
    pattern = entry.get("pattern")
    if not isinstance(pattern, str) or not pattern.startswith("/"):
        raise ValueError(f"{source}: route entry {entry!r} needs a 'pattern' starting with /")
    methods = entry.get("methods")
    if methods is not None and not (
        isinstance(methods, list) and all(isinstance(m, str) for m in methods)
    ):
        raise ValueError(f"{source}: 'methods' of {pattern!r} must be a list of strings")


def _compile(entry: Mapping[str, Any]) -> _Route:
    _check_entry(entry, "route list")
    pattern = str(entry["pattern"])
    methods = entry.get("methods")
    return _Route(
        match=RouteMatch(pattern=pattern, asset=bool(entry.get("asset", False))),
        regex=_pattern_regex(pattern),
        methods=None if methods is None else frozenset(str(m).upper() for m in methods),
    )


def _pattern_regex(pattern: str) -> re.Pattern[str]:
    wildcard = pattern.endswith(_WILDCARD)
    base = _normalize(pattern[: -len(_WILDCARD)] if wildcard else pattern)
    if wildcard and base == "/":
        base = ""
    body = "/".join(_segment_regex(segment) for segment in base.split("/"))
    return re.compile(body + ("(?:/.*)?" if wildcard else ""))


def _segment_regex(segment: str) -> str:
    return "[^/]+" if _PARAM.fullmatch(segment) else re.escape(segment)


def _normalize(path: str) -> str:
    if len(path) > 1 and path.endswith("/"):
        return path[:-1]
    return path
