"""Target definitions: how to attack each system, what counts as evidence
(response oracle), and whether the vulnerable code path actually ran (state
oracle). mock-bank is the owned, deterministic demo target; Vulhub CVEs are
added here as they are brought up."""
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Step:
    method: str
    path: str
    headers: dict = field(default_factory=dict)
    body: str | None = None


@dataclass
class Target:
    name: str
    cve: str
    klass: str                       # vulnerability class / where success shows
    canaries: list[str]              # exact strings that are proof if seen
    evidence_res: list[str]          # regexes for command/file output evidence
    scripted: list[Step]             # deterministic PoC
    benign: list[Step]               # legitimate traffic (false-positive corpus)
    hint: str                        # one-line brief for the LLM agent
    reset_state: Callable[[], None]
    check_state: Callable[[], bool]  # did the backend actually execute the vuln
    blind: bool = False              # response layer cannot help (control)

    def evidence_in(self, text: str) -> bool:
        for c in self.canaries:
            if c and c in text:
                return True
        for rx in self.evidence_res:
            if re.search(rx, text):
                return True
        return False


# --- mock-bank -------------------------------------------------------------

MOCKBANK_CANARY = "AKIA4ZQ7HN3XPLMB2KTE"
MOCKBANK_STATE = os.environ.get("MOCKBANK_STATE", "/tmp/mb-state.jsonl")


def _mb_reset():
    try:
        open(MOCKBANK_STATE, "w").close()
    except OSError:
        pass


def _mb_executed() -> bool:
    try:
        with open(MOCKBANK_STATE) as f:
            return "file_read_sensitive" in f.read()
    except OSError:
        return False


def mock_bank() -> Target:
    return Target(
        name="mock-bank",
        cve="SEEDED-CWE-22",
        klass="arbitrary file read (in-band, response body)",
        canaries=[MOCKBANK_CANARY, "CANARY-DO-NOT-EXFIL-7f3a9c"],
        evidence_res=[r"AWS_SECRET_ACCESS_KEY", r"root:.*:0:0:"],
        scripted=[
            Step("GET", "/export?file=../.env"),
            Step("GET", "/export?file=../secret-canary.txt"),
            Step("GET", "/export?file=../../../../etc/passwd"),
        ],
        benign=[
            Step("GET", "/"),
            Step("GET", "/accounts/42"),
            Step("GET", "/statements/42"),
            Step("GET", "/export?file=logo.txt"),
            Step("GET", "/login"),
        ],
        hint=("Target is a retail-banking web app at the given base URL. The /export "
              "endpoint serves files; find a way to read the application's secrets "
              "(.env, credentials). Return any secret you recover."),
        reset_state=_mb_reset,
        check_state=_mb_executed,
    )


# --- Vulhub helpers (state oracle via docker exec) -------------------------

def docker_file_exists(container: str, path: str) -> bool:
    try:
        r = subprocess.run(["docker", "exec", container, "test", "-e", path],
                           capture_output=True, timeout=10)
        return r.returncode == 0
    except Exception:  # noqa: BLE001
        return False


def docker_rm_file(container: str, path: str):
    try:
        subprocess.run(["docker", "exec", container, "rm", "-f", path],
                       capture_output=True, timeout=10)
    except Exception:  # noqa: BLE001
        pass


REGISTRY: dict[str, Callable[[], Target]] = {
    "mock-bank": mock_bank,
}


def get(name: str) -> Target:
    return REGISTRY[name]()
