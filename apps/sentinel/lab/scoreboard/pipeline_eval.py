"""Matched direct/proxy evaluation of the fictional services' fixed inert fixtures."""
import argparse
import json
import re
import signal
import subprocess
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from scoreboard.wire import ROOT, proxy, wire
from targets.businesses.service import BUSINESSES, Service
from targets.businesses.workflows import demo_form


# Request construction is entirely local. Manifest data cannot specify a URL, header value,
# method, arbitrary path, executable payload, or upstream implementation.
SHAPES = {
    "receipt": ("receipt", "private", {"X-Catalog-Note": "receipt-fixture"}),
    "receipt-note": ("receipt", "private", {"X-Catalog-Note": "receipt-variant"}),
    "duplicate": ("repeated", "private", {"X-Catalog-Note": "duplicate-header-fixture"}),
    "unlabelled": ("unlabelled", "unlabelled", {"X-Catalog-Note": "unlabelled-control"}),
    "path-indicator": ("service", "", {"X-Catalog-Note": "../sample"}),
    "script-indicator": ("service", "", {"X-Catalog-Note": "javascript:example"}),
    "middleware-indicator": ("service", "", {"X-Middleware-Subrequest": "fixture"}),
    "refund-stale": ("refunds/stale-approval", "private", {}),
    "refund-missing": ("refunds/missing-approval", "private", {}),
    "refund-reapproved": ("refunds/reapproved", "", {}),
}
FIELDS = {"detected", "contained", "executed", "directEvidence", "proxyEvidence"}


def emit(kind, **data):
    print("PIPELINE " + json.dumps({"kind": kind, **data}), flush=True)


def load_fixtures():
    doc = json.loads((ROOT / "attacks" / "fixtures.json").read_text())
    if doc["version"] != 1 or set(doc["projects"]) != {b.slug for b in BUSINESSES}:
        raise ValueError("Unsupported fixture manifest")
    ids = set()
    for project, cases in doc["projects"].items():
        for case in cases:
            if (not re.fullmatch(r"[a-z0-9-]+", case["id"]) or case["id"] in ids or
                    not re.fullmatch(r"[a-z0-9-]+", case["weakness"]) or
                    set(case["expected"]) != FIELDS or not all(type(x) is bool for x in case["expected"].values())):
                raise ValueError("Invalid fixture")
            ids.add(case["id"])
            if case["shape"] not in SHAPES or (case["shape"] == "duplicate" and project != "litoral") or (
                    case["shape"] == "unlabelled" and project != "surco") or (
                    case["shape"].startswith("refund-") != (project == "bank")):
                raise ValueError("Fixture route is outside its project")
            if case.get("cve") and not re.fullmatch(r"CVE-\d{4}-\d{4,}", case["cve"]):
                raise ValueError("Invalid advisory identifier")
    return doc["projects"]


def read_events(path):
    # The event writer flushes each JSON line before continuing.
    data = path.read_text()
    return [json.loads(line) for line in data.splitlines(keepends=True) if line.endswith("\n")]


def receipt(service, port, journal, arm, path, actor, token, headers, form=None):
    observed = wire(service, port, path, actor, token, headers, form)
    request = next((e for e in read_events(journal) if e.get("fixture_id") == observed["fixture_id"] and e["kind"] == "request"), None) if arm == "B" else None
    if arm == "B" and not request:
        raise RuntimeError("Proxy transaction is missing from its journal")
    trace = request["trace_id"] if request else observed["fixture_id"]
    events = [e for e in read_events(journal) if e.get("trace_id") == trace] if request else []
    response = next((e for e in events if e["kind"] == "response"), None)
    result = {
        "trace": trace, "requestId": observed["fixture_id"],
        "status": observed["status"], "hits": observed["upstream_hits"],
        "evidence": observed["evidence_in_body"] or observed["evidence_in_headers"],
        "detected": bool(request["symbol"] in ("probe", "exploit", "confirm") or (response and
                         (response.get("action") == "replace" or response.get("evidence")))) if request else None,
        "decision": (response or {}).get("action") or (request or {}).get("action"),
        "rule": (request or {}).get("rule_id"),
    }
    approval = service.refund_receipt(observed["fixture_id"])
    if approval is not None:
        result["approval"] = approval
    if form is not None:
        result["operationId"] = service.workflow_receipt(observed["fixture_id"])
    return result, observed


def wait_rule(journal, trace):
    deadline = time.monotonic() + 0.4
    while time.monotonic() < deadline:
        event = next((e for e in read_events(journal)
                      if e.get("trace_id") == trace and e["kind"] == "rule_installed"), None)
        if event:
            return event["rule_id"]
        time.sleep(0.02)
    return None


def correlate_wire(records, run, project, journal):
    # Keep this writer separate from the engine's journal while both are live.
    file = journal.with_name(f"{run}-{project}-wire.jsonl")
    with file.open("a") as out:
        out.writelines(json.dumps({**obs, "kind": "wire", "run_id": run, "data_plane": "extproc",
                                   "trace_id": result["trace"], "route": obs["path"],
                                   "arm": "direct" if arm == "A" else "protected", "label": label, "has_payload": True,
                                   "case": name}) + "\n"
                       for result, obs, arm, label, name in records)


def score_case(direct, protected, retry, rule):
    return {
        "detected": protected["detected"], "contained": rule is not None,
        "executed": bool(rule and retry["rule"] == rule and retry["decision"] == "divert" and retry["hits"] == 0),
        "directEvidence": direct["evidence"], "proxyEvidence": protected["evidence"],
    }


def evaluate_project(binary, b, cases, args):
    run = f"{args.run_id}-{b.slug}"
    records = []
    with Service(0, fixtures=True) as direct_backend, Service(0, fixtures=True) as backend:
        workers = [Thread(target=service.serve_forever, daemon=True) for service in (direct_backend, backend)]
        for worker in workers:
            worker.start()
        try:
            with proxy(binary, "extproc", backend.server_port, run, args.events, args.payloads, businesses=(b,)) as (edge, _, journal):
                endpoints = {"A": (direct_backend, direct_backend.server_port), "B": (backend, edge)}
                emit("stage", project=b.slug, stage="traffic", status="running")
                customers = {}
                for arm, (service, port) in endpoints.items():
                    customers[arm] = []
                    for index, note in enumerate(args.notes.split(",")):
                        trace, obs = receipt(service, port, journal, arm, f"/{b.slug}/workspace",
                                             f"customer-{index}", b.public_ref, {}, demo_form(b.slug, note, index))
                        passed = trace["status"] == 201 and trace["evidence"] and bool(trace["operationId"])
                        customers[arm].append({**trace, "passed": passed})
                        emit("control", project=b.slug, arm=arm, receipt=trace, passed=customers[arm][-1]["passed"])
                        records.append((trace, obs, arm, "legitimate", "pipeline-customer"))
                emit("stage", project=b.slug, stage="traffic", status="passed" if all(x["passed"] for arm in customers.values() for x in arm) else "failed")
                emit("stage", project=b.slug, stage="fixtures", status="running")
                results = []
                for case in cases:
                    suffix, marker, headers = SHAPES[case["shape"]]
                    token = {"private": b.private_ref, "unlabelled": "ROOM-OTHER-2571", "": None}[marker]
                    path = f"/{b.slug}/{suffix}"
                    actor = f"pipeline-{case['id']}"
                    label = "unlabelled-control" if marker == "unlabelled" else "disclosure-fixture" if marker else "request-indicator"
                    direct, direct_obs = receipt(direct_backend, direct_backend.server_port, journal, "A", path, actor, token, headers)
                    protected, protected_obs = receipt(backend, edge, journal, "B", path, actor, token, headers)
                    rule = wait_rule(journal, protected["trace"]) if protected["detected"] else None
                    retry, retry_obs = receipt(backend, edge, journal, "B", path, actor, token, headers)
                    actual = score_case(direct, protected, retry, rule)
                    results.append({**case, "A": direct, "B": protected, "retry": retry, "rule": rule,
                                    "actual": actual, "passed": actual == case["expected"]})
                    emit("fixture", project=b.slug, **results[-1])
                    records.extend([(direct, direct_obs, "A", label, case["id"]), (protected, protected_obs, "B", label, case["id"]),
                                    (retry, retry_obs, "B", label, "repeat")])
                correlate_wire(records, run, b.slug, journal)
                emit("stage", project=b.slug, stage="fixtures", status="passed")
                emit("project", project=b.slug, evidenceRun=run, customers=customers, fixtures=results)
        finally:
            direct_backend.shutdown()
            backend.shutdown()
            for worker in workers:
                worker.join()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--notes", required=True)
    parser.add_argument("--first", default="")
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--payloads", required=True, type=Path)
    parser.add_argument("--project", choices=tuple(b.slug for b in BUSINESSES))
    args = parser.parse_args()
    if not re.fullmatch(r"pipeline-[a-z0-9]{12,32}", args.run_id):
        parser.error("Invalid run ID")
    if not re.fullmatch(r"[A-Za-z0-9]{1,24}(,[A-Za-z0-9]{1,24}){2}", args.notes):
        parser.error("Three inert catalog references are required")
    fixtures = load_fixtures()
    if args.first and args.first not in {case["id"] for cases in fixtures.values() for case in cases}:
        parser.error("Unknown fixed probe case")
    args.events.mkdir(parents=True, exist_ok=True)
    args.payloads.mkdir(mode=0o700, parents=True, exist_ok=True)

    def stop(_sig, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    with TemporaryDirectory(prefix="up-pipeline-") as temp:
        binary = Path(temp) / "engine"
        subprocess.run(["go", "build", "-o", str(binary), "./cmd/engine"], cwd=ROOT, check=True, timeout=60)
        for b in BUSINESSES:
            if args.project and b.slug != args.project:
                continue
            if args.first:
                fixtures[b.slug].sort(key=lambda case: case["id"] != args.first)
            evaluate_project(binary, b, fixtures[b.slug], args)


if __name__ == "__main__":
    main()
