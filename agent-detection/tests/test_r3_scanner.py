"""R3 scanner fingerprints: the fixed requests Nmap sends to identify a web server."""

from __future__ import annotations

from pathlib import Path

import pytest

from engine.rules.r3_flags import flag
from mirror.contracts import TrackOpened
from tests.test_mirror_lane import build, fwd

PROBES = [
    "/HNAP1",
    "/HNAP1/",
    "/hnap1",
    "//HNAP1",
    "/%48NAP1",
    "/nmaplowercheck1628719441",
    "/nmaplowercheck0",
    "/NmapLowerCheck42",
    "/nice ports,/Trinity.txt.bak",
    "/nice%20ports%2C/Tri%6Eity.txt%2ebak",
    "/nice%20ports,/Trinity.txt.bak",
    "/nice+ports,/Trinity.txt.bak",
    "/evox/about",
    "/evox/about/",
    "/sdk",
    "/sdk/",
    "/%73dk",
]

SHOP_PATHS = [
    "/sdk-docs",
    "/sdks",
    "/docs/sdk",
    "/products/sdk",
    "/api/sdk",
    "/hnap10",
    "/hnap1.html",
    "/shop/hnap1",
    "/evox",
    "/evox/aboutus",
    "/evox/about/team",
    "/nmaplowercheck",
    "/nmaplowercheckup",
    "/nice-ports",
    "/blog/nice ports, trinity",
    "/products/trinity.txt",
    "/search",
]


@pytest.mark.parametrize("path", PROBES)
def test_an_nmap_probe_is_a_critical_flag(path: str) -> None:
    assert flag(path, "") == "nmap probe"


@pytest.mark.parametrize("path", SHOP_PATHS)
def test_a_shop_path_that_only_looks_alike_is_not(path: str) -> None:
    assert flag(path, "") is None


def test_the_first_probe_of_a_scanner_goes_to_the_twin(tmp_path: Path) -> None:
    lane = build(tmp_path)
    decision = lane.router.decide(fwd("/HNAP1"))
    assert (decision.lane, decision.opened) == ("mirror", True)
    [opened] = lane.events
    assert isinstance(opened, TrackOpened)
    assert opened.reason == "critical flag: nmap probe"
