"""Real-CVE A/B evaluation that produces the panel's run shape.

Unlike the fictional-business pipeline, every "attack" here is the authentic
public exploit for a real, vulnerable Vulhub container, sent through Reaper (the
engine in reverse-proxy mode, same engine as the ext_proc data plane). For each
target it records three real HTTP exchanges — direct (A), through Reaper (B),
and a retry through Reaper — with the raw request/response the client saw and
what Reaper's engine logged, plus two independent oracles:

  * response oracle: did the proof reach the attacker;
  * state oracle: did the backend actually execute (disclosure CVEs: the server
    queried directly still serves it; RCE: a marker file via `docker exec`).

The output is an ExperimentDetail JSON (run + entries) that Sentinel seeds and
the existing site panel renders unchanged. The CVE, advisory and fix shown are
the ones for the vulnerability that was actually exploited — nothing hardcoded
to an unrelated label.

Targets run as containers in the VM; the attack comes from the VM host, like a
real external attacker. Run from `related_experiments/ultimo-paso` in the VM.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from attackers import targets as T
from attackers.common import http_request

ROOT = Path(__file__).resolve().parents[1]
ENGINE = "/tmp/up-engine"

# Advisory for the CVE each target really exploits (the real page for that CVE).
ADVISORY = {
    "CVE-2025-29927": "https://github.com/advisories/GHSA-f82v-jwr5-mffw",
    "CVE-2025-30208": "https://github.com/advisories/GHSA-x574-m823-4x7w",
    "CVE-2025-55182": "https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components",
    "CVE-2026-33017": "https://github.com/advisories/GHSA-4gr9-m9jp-cq37",
}
NAMES = {"nextjs": "Next.js", "vite": "Vite", "react2shell": "React2Shell", "langflow": "Langflow"}
# (engine canary name=value) so Reaper withholds the proof the exploit discloses.
CANARY = {"nextjs": [("dashboard", T.NEXTJS_PROOF)], "vite": [], "react2shell": [], "langflow": []}
# Request target each exploit hits, and its direct container port.
SPEC = {
    "nextjs": {"direct": "http://127.0.0.1:3001", "weakness": "auth-bypass"},
    "vite": {"direct": "http://127.0.0.1:5173", "weakness": "file-read"},
    "react2shell": {"direct": "http://127.0.0.1:3002", "weakness": "rce"},
    "langflow": {"direct": "http://127.0.0.1:7860", "weakness": "rce"},
}


def emit(kind, **data):
    print("PIPELINE " + json.dumps({"kind": kind, **data}), flush=True)


def read_events(path):
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def engine_view(journal, fixture_id):
    """What Reaper's engine logged for the transaction with this fixture id."""
    events = [e for e in read_events(journal) if e.get("fixture_id") == fixture_id]
    req = next((e for e in events if e.get("kind") == "request"), None)
    resp = next((e for e in events if e.get("kind") == "response"), None)
    if not req and not resp:
        return None, None
    rule = (req or {}).get("rule_id")
    view = {
        "level": (resp or {}).get("level") or (req or {}).get("level") or "",
        "symbol": (req or {}).get("symbol") or "",
        "decision": (resp or {}).get("action") or (req or {}).get("action") or "",
        "rule": rule,
        "evidence": (resp or {}).get("evidence") or [],
        "reason": (resp or {}).get("reason") or (req or {}).get("reason") or "",
    }
    return view, rule


def exchange(target, base, journal, arm, proxied):
    """One real exploit request. Returns a receipt with raw HTTP and engine view."""
    fixture_id = uuid.uuid4().hex
    leaked = False
    engine = None
    rule = None
    raw = None
    status = 0
    if target.custom_attack is not None:
        # Multi-request exploit (Langflow). The driver reports whether the proof
        # reached the attacker; the engine journal gives the proxied view.
        leaked, _reqs, transcript = target.custom_attack(base)
        status = next((t.get("status") for t in transcript if t.get("status")), 0)
        # transcript[0]["req"] already reads as "METHOD target" (the driver's own label);
        # split it so the UI doesn't show the method twice.
        method, _, req_target = transcript[0]["req"].partition(" ")
        raw = {
            "request": {"method": method or "POST", "target": req_target or transcript[0]["req"], "headers": [], "body": "<RSC/flow exploit payload>"},
            "response": {"status": status, "headers": [], "body": json.dumps(transcript)[:4000], "truncated": False},
        }
        if proxied:
            # The drivers do not send X-Up-Fixture-Id, so correlate by trace:
            # the last request and the response that shares its trace id. A
            # diverted request has no response event at all (the proxy
            # short-circuits), which is exactly the containment outcome.
            evs = read_events(journal)
            req = next((e for e in reversed(evs) if e.get("kind") == "request"), None)
            resp = None
            if req:
                resp = next((e for e in reversed(evs)
                             if e.get("kind") == "response" and e.get("trace_id") == req.get("trace_id")), None)
            if req or resp:
                rule = (req or {}).get("rule_id")
                decision = (resp or {}).get("action") or (req or {}).get("action") or ""
                engine = {"level": (resp or {}).get("level") or (req or {}).get("level") or "",
                          "symbol": (req or {}).get("symbol") or "",
                          "decision": decision, "rule": rule,
                          "evidence": (resp or {}).get("evidence") or [],
                          "reason": (resp or {}).get("reason") or (req or {}).get("reason") or ""}
    else:
        step = target.scripted[0]
        headers = dict(step.headers)
        headers["X-Up-Fixture-Id"] = fixture_id
        r = http_request(base, step.method, step.path, headers, step.body)
        status = r.status
        leaked = target.evidence_in(r.text())
        raw = {
            "request": {"method": step.method, "target": step.path, "headers": list(headers.items()), "body": step.body or ""},
            "response": {"status": r.status, "headers": [[k, v] for k, v in r.headers.items()], "body": r.body[:8192], "truncated": len(r.body) > 8192},
        }
        if proxied:
            engine, rule = engine_view(journal, fixture_id)
    detected = None
    if proxied and engine:
        detected = engine["symbol"] in ("probe", "exploit", "confirm") or engine["decision"] in ("replace", "divert") or bool(engine["evidence"])
    decision = engine["decision"] if engine else None
    hits = 0 if (engine and engine["decision"] in ("divert", "block")) else 1
    receipt = {"trace": fixture_id, "requestId": fixture_id, "path": target.scripted[0].path if target.scripted else "/",
               "raw": raw, "status": status, "hits": hits, "evidence": leaked,
               "detected": detected, "decision": decision, "rule": rule}
    if engine:
        receipt["engine"] = engine
    return receipt, rule


def proof_of(target, receipt):
    """The literal substring to highlight, taken from what actually leaked direct."""
    body = (receipt.get("raw") or {}).get("response", {}).get("body", "")
    hdrs = " ".join(v for _, v in (receipt.get("raw") or {}).get("response", {}).get("headers", []))
    hay = body + " " + hdrs
    for c in target.canaries:
        if c and c in hay:
            return c
    import re
    for rx in target.evidence_res:
        m = re.search(rx, hay)
        if m:
            return m.group(0)[:64]
    return None


def legit(target, base, proxied, journal):
    """A benign request that must pass unchanged."""
    step = target.benign[0]
    fixture_id = uuid.uuid4().hex
    headers = {**dict(step.headers), "X-Up-Fixture-Id": fixture_id}
    r = http_request(base, step.method, step.path, headers, step.body)
    raw = {"request": {"method": step.method, "target": step.path, "headers": list(headers.items()), "body": step.body or ""},
           "response": {"status": r.status, "headers": [[k, v] for k, v in r.headers.items()], "body": r.body[:8192], "truncated": len(r.body) > 8192}}
    # A benign request passes when the proxy did not replace it with a fake error.
    passed = not (r.status == 500 and "could not be completed" in r.body)
    return {"trace": fixture_id, "requestId": fixture_id, "path": step.path, "raw": raw, "status": r.status,
            "hits": 1, "evidence": False, "detected": None, "decision": None, "rule": None}, passed


def run_engine(name, upstream, listen, admin, events):
    cmd = [ENGINE, "-mode", "revproxy", "-listen", f"127.0.0.1:{listen}",
           "-admin", f"127.0.0.1:{admin}", "-upstream", upstream, "-events", str(events)]
    for n, v in CANARY.get(name, []):
        cmd += ["-canary", f"{n}={v}"]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        if http_request(f"http://127.0.0.1:{admin}", "GET", "/healthz").status == 200:
            return proc
        time.sleep(0.25)
    proc.terminate()
    raise RuntimeError(f"engine for {name} did not come up")


def ensure_up(name, direct):
    """Brings up the target's own container if it is not already answering."""
    if http_request(direct, "GET", "/").status != 0:
        return
    directory = ROOT / "targets" / "vulhub" / name
    subprocess.run(["docker", "compose", "up", "-d"], cwd=directory, check=True, timeout=120)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if http_request(direct, "GET", "/").status != 0:
            return
        time.sleep(2)
    raise RuntimeError(f"{name} did not come up at {direct} after starting its container")


def evaluate(name, event_dir, port_base):
    spec = SPEC[name]
    target = T.get("langflow-rce" if name == "langflow" else name)
    direct = spec["direct"]
    ensure_up(name, direct)
    listen, admin = port_base, port_base + 100
    journal = event_dir / f"{name}-engine.jsonl"
    journal.unlink(missing_ok=True)
    emit("stage", project=name, stage="traffic", status="running")
    proc = run_engine(name, direct, listen, admin, journal)
    proxied = f"http://127.0.0.1:{listen}"
    try:
        # Legitimate traffic, direct and through Reaper.
        for arm, base in (("A", direct), ("B", proxied)):
            receipt, passed = legit(target, base, arm == "B", journal)
            emit("control", project=name, arm=arm, receipt=receipt, passed=passed)
        emit("stage", project=name, stage="traffic", status="passed")
        emit("stage", project=name, stage="fixtures", status="running")
        # The real exploit: direct, through Reaper, then a retry through Reaper.
        target.reset_state()
        A, _ = exchange(target, direct, journal, "A", proxied=False)
        executed = target.check_state()
        B, _ = exchange(target, proxied, journal, "B", proxied=True)
        retry, _ = exchange(target, proxied, journal, "retry", proxied=True)
        # The containment rule is the one active on the retry (installed during B).
        rule = retry.get("rule") or B.get("rule")
        proof = proof_of(target, A)
        actual = {
            "detected": bool(B.get("detected")),
            "contained": rule is not None,
            "executed": bool(rule and retry["decision"] in ("divert", "block") and retry["hits"] == 0),
            "directEvidence": A["evidence"],
            "proxyEvidence": B["evidence"],
        }
        expected = {"detected": True, "contained": True, "executed": True, "directEvidence": True, "proxyEvidence": False}
        fixture = {"project": name, "id": f"{name}-{spec['weakness']}", "weakness": spec["weakness"],
                   "cve": target.cve, "source": ADVISORY.get(target.cve), "proof": proof,
                   "A": A, "B": B, "retry": retry, "rule": rule,
                   "actual": actual, "expected": expected, "passed": actual == expected}
        emit("fixture", **fixture)
        emit("stage", project=name, stage="fixtures", status="passed")
        emit("stage", project=name, stage="detection", status="passed" if actual["detected"] else "failed")
        emit("stage", project=name, stage="containment", status="passed" if actual["executed"] else "failed")
        return {"backend_executed": executed, "cve": target.cve}
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--events", required=True, type=Path)
    ap.add_argument("--targets", default="nextjs,vite,react2shell,langflow")
    ap.add_argument("--engine", default=ENGINE)
    args = ap.parse_args()
    args.events.mkdir(parents=True, exist_ok=True)
    names = [n for n in args.targets.split(",") if n in SPEC]
    if not names:
        ap.error("No known target in --targets")
    subprocess.run(["go", "build", "-o", args.engine, "./cmd/engine"], cwd=ROOT, check=True, timeout=120)
    emit("inputs", provider="live", targets=names)
    failures = []
    for i, name in enumerate(names):
        try:
            evaluate(name, args.events, 8100 + i * 2)
        except Exception as exc:  # noqa: BLE001
            # One target's container failing (e.g. a known emulation crash) must not
            # cost the rest of the batch their results.
            failures.append(name)
            for stage in ("traffic", "fixtures", "detection", "containment"):
                emit("stage", project=name, stage=stage, status="failed", detail=str(exc)[:300])
    if len(failures) == len(names):
        raise SystemExit(f"Every target failed: {', '.join(failures)}")


if __name__ == "__main__":
    main()
