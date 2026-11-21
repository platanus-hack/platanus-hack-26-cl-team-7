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
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        return cls.from_patterns(data.get("routes") or [])

    @classmethod
    def from_patterns(cls, patterns: Sequence[Mapping[str, Any]]) -> RouteTable:
        return cls([_compile(entry) for entry in patterns])

    def match(self, method: str, path: str) -> RouteMatch | None:
        target = _normalize(path)
        for route in self._routes:
            if route.accepts(method, target):
                return route.match
        return None


def _compile(entry: Mapping[str, Any]) -> _Route:
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
