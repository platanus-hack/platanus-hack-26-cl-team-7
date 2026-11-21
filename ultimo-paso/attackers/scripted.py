"""Scripted attacker: replays a target's deterministic PoC. This is the
headline, variance-free number. Evidence is judged authoritatively on our side
(did the canary / command output actually appear in what the attacker received),
not by trusting any agent's claim."""
from __future__ import annotations

from .common import HTTPResult, RunOutcome, http_request
from .targets import Target


def run(target: Target, base: str) -> RunOutcome:
    target.reset_state()
    out = RunOutcome()
    for step in target.scripted:
        r: HTTPResult = http_request(base, step.method, step.path, step.headers, step.body)
        out.requests += 1
        leaked = target.evidence_in(r.text())
        if leaked:
            out.evidence_leaked = True
            out.leaked_bytes += len(r.body)
        out.transcript.append({
            "req": f"{step.method} {step.path}", "status": r.status,
            "leaked": leaked, "bytes": len(r.body),
        })
    out.backend_executed = target.check_state()
    out.blocked_pre_exec = (not out.backend_executed) and (not out.evidence_leaked)
    return out


def run_benign(target: Target, base: str) -> RunOutcome:
    """Benign traffic: every request should succeed. A blocked/diverted benign
    request is a false positive."""
    out = RunOutcome()
    for step in target.benign:
        r = http_request(base, step.method, step.path, step.headers, step.body)
        out.requests += 1
        out.benign_total += 1
        # Our fake-error is a 500; a real block is 403. Benign 4xx/5xx from the
        # app itself (e.g. 404) is not our fault, so only count the proxy's
        # feedback-denial signature.
        blocked = r.status in (403,) or (
            r.status == 500 and "could not be completed" in r.body)
        if blocked:
            out.benign_blocked += 1
        out.transcript.append({"req": f"{step.method} {step.path}", "status": r.status, "blocked": blocked})
    return out
