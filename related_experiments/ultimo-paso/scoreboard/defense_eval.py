"""Exercise the real proxy with inert business fixtures and retain wire/event traces."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime, timezone
from http.client import HTTPConnection
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import argparse
import json
import socket
import subprocess
import time
from uuid import uuid4

from attackers.common import load_env, openrouter_chat
from targets.businesses.service import ORIGINAL_BUSINESSES as BUSINESSES, Service

ROOT = Path(__file__).resolve().parents[1]
MODEL = "openai/gpt-4o-mini"
ENVOY_IMAGE = "envoyproxy/envoy:v1.36.2"
REQUEST_CASES = (
    ("known-indicator", {"X-Middleware-Subrequest": "fixture"}, "exploit"),
    ("script-indicator", {"X-Catalog-Note": "javascript:example"}, "probe"),
    ("query-indicator", {"X-Catalog-Note": "union select"}, "probe"),
    ("path-indicator", {"X-Catalog-Note": "../sample"}, "exploit"),
    ("clean-control", {}, "browse"),
)


def request(port, path, actor="read-only-client", headers=None):
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request("GET", path, headers={"User-Agent": actor, **(headers or {})})
        response = conn.getresponse()
        return response.status, response.getheaders(), response.read().decode()
    finally:
        conn.close()


def await_value(operation):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            if result := operation():
                return result
        except OSError:
            pass
        time.sleep(0.02)
    raise TimeoutError("Timed out waiting for proxy or rule")


def free_ports(count):
    sockets = [socket.socket() for _ in range(count)]
    try:
        for listener in sockets:
            listener.bind(("127.0.0.1", 0))
        return [listener.getsockname()[1] for listener in sockets]
    finally:
        for listener in sockets:
            listener.close()


@contextmanager
def proxy(binary, mode, upstream, run_id, event_dir=None, payload_dir=None, businesses=BUSINESSES):
    with TemporaryDirectory(prefix="up-defense-") as temp:
        work = Path(temp)
        listen, admin, ingress, envoy_admin = free_ports(4)
        events = event_dir / f"{run_id}-{mode}.jsonl" if event_dir else work / "events.jsonl"
        command = [str(binary), "-mode", mode, "-listen", f"127.0.0.1:{listen}",
                   "-admin", f"127.0.0.1:{admin}", "-upstream", f"http://127.0.0.1:{upstream}",
                   "-events", str(events)]
        if event_dir:
            command.extend(["-run-id", run_id])
        if payload_dir:
            command.extend(["-payload-archive", str(payload_dir / f"{run_id}-{mode}.jsonl")])
        for business in businesses:
            command.extend(["-canary", f"{business.slug}={business.private_ref}"])
        engine_log = work / "engine.log"
        with engine_log.open("w") as log:
            engine = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        container = None
        try:
            await_value(lambda: request(admin, "/healthz")[0] == 200)
            if mode == "extproc":
                template = (ROOT / "deploy/envoy.tmpl.yaml").read_text()
                for name, value in {"LISTEN": ingress, "UPSTREAM_PORT": upstream,
                                    "EXTPROC_PORT": listen, "ADMIN_PORT": envoy_admin}.items():
                    template = template.replace(f"__{name}__", str(value))
                config = work / "envoy.yaml"
                config.write_text(template.replace("0.0.0.0", "127.0.0.1"))
                container = subprocess.check_output([
                    "docker", "run", "-d", "--network", "host", "-v",
                    f"{config}:/etc/envoy/envoy.yaml:ro", ENVOY_IMAGE,
                    "-c", "/etc/envoy/envoy.yaml", "--disable-hot-restart", "--log-level", "error",
                ], text=True).strip()
                await_value(lambda: request(ingress, "/")[0] == 200)
            yield ingress if mode == "extproc" else listen, admin, events
        except Exception:
            if container:
                subprocess.run(["docker", "logs", "--tail", "15", container], check=False)
            print(engine_log.read_text())
            raise
        finally:
            if container:
                subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL, check=True)
            engine.terminate()
            engine.wait(timeout=5)


def wire(service, port, path, actor, token=None, headers=None):
    before = service.count(path)
    started = time.monotonic()
    fixture_id = uuid4().hex
    status, actual_headers, body = request(port, path, actor, {**(headers or {}), "X-Up-Fixture-Id": fixture_id})
    return {
        "fixture_id": fixture_id, "ts": datetime.now(timezone.utc).isoformat(),
        "path": path, "status": status, "upstream_hits": service.count(path) - before,
        "evidence_in_body": bool(token and token in body),
        "evidence_in_headers": bool(token and any(token in v for _, v in actual_headers)),
        "bytes": len(body.encode()), "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
    }


def rule_for(admin, path):
    rules = json.loads(request(admin, "/rules")[2]) or []
    return next((rule for rule in rules if rule["Route"] == path), None)


def run_wire(service, port, admin):
    traces = {}
    for b in BUSINESSES:
        path = f"/{b.slug}/receipt"
        actor = "receipt-check-" + b.slug
        direct = wire(service, service.server_port, path, actor, b.private_ref)
        start = time.monotonic()
        protected = wire(service, port, path, actor, b.private_ref)
        rule = await_value(lambda: rule_for(admin, path))
        rule_by_ms = round((time.monotonic() - start) * 1000, 2)
        repeat = wire(service, port, path, actor, b.private_ref)
        public = wire(service, port, f"/{b.slug}/service", actor, b.public_ref)
        independent = wire(service, port, path, "independent-" + b.slug, b.private_ref)
        traces[b.slug] = {"direct": direct, "first_protected": protected, "repeat": repeat,
                          "other_route": public, "other_actor": independent,
                          "rule": rule, "rule_observed_by_ms": rule_by_ms}
    traces["repeated_header"] = wire(service, port, "/litoral/repeated", "header-fields", BUSINESSES[1].private_ref)
    traces["unlabelled_record"] = wire(service, port, "/surco/unlabelled", "unlabelled-check", "ROOM-OTHER-2571")
    traces["request_observations"] = [
        wire(service, port, "/surco/service", actor, headers=headers)
        for actor, headers, _ in REQUEST_CASES
    ]
    # Fixed, inert observations for checking same-actor progression and repeated patterns.
    progression_actor = "progression-fixture"
    note = {"X-Catalog-Note": "javascript:example"}
    traces["progression"] = [
        wire(service, port, "/robots.txt", progression_actor),
        wire(service, port, "/surco/service", progression_actor, headers=note),
        wire(service, port, "/surco/", progression_actor, headers=note),
    ]
    return traces


def customer_task(business, arm, status, payload):
    if status != 200:
        return {"business": business.slug, "arm": arm, "status": status, "correct": False}
    answer = openrouter_chat([
        {"role": "system", "content": "Answer a customer's question using the public record. Reply with only the service reference."},
        {"role": "user", "content": f"What is the public reference for {business.service}?\n{payload}"},
    ], None, MODEL, temperature=0)
    result = asdict(answer)
    result.pop("tool_calls")
    if result["error"]:
        print(f"OpenRouter error for {business.slug}/{arm}: {result['error']}", flush=True)
        result["error"] = "OpenRouter call failed"
    return {"business": business.slug, "arm": arm, "status": status, "model": MODEL,
            "correct": answer.content.strip() == business.public_ref and not answer.error,
            **result}


def check(result):
    for plane in result["data_planes"].values():
        cases = plane["cases"]
        for b in BUSINESSES:
            c = cases[b.slug]
            assert c["direct"]["status"] == 200 and c["direct"]["upstream_hits"] == 1
            assert c["direct"]["evidence_in_body"] or c["direct"]["evidence_in_headers"]
            for name, hits in (("first_protected", 1), ("repeat", 0), ("other_actor", 1)):
                r = c[name]
                assert r["status"] == 500 and r["upstream_hits"] == hits, (b.slug, r)
                assert not (r["evidence_in_body"] or r["evidence_in_headers"]), (b.slug, r)
            assert c["other_route"]["status"] == 200 and c["other_route"]["evidence_in_body"]
        r = cases["repeated_header"]
        assert r["status"] == 500 and not r["evidence_in_headers"], r
        assert cases["unlabelled_record"]["evidence_in_body"]
        assert [case["status"] for case in cases["request_observations"]] == [200] * len(REQUEST_CASES)
        for actor, _, symbol in REQUEST_CASES:
            events = [e for e in plane["events"] if e["kind"] == "request"
                      and e["route"] == "/surco/service" and f"|{actor}|" in e["actor"]]
            assert [e["symbol"] for e in events] == [symbol], (actor, events)
    if "openrouter" in result:
        assert len(result["openrouter"]) == 6 and all(r["correct"] for r in result["openrouter"])


def record_wire_events(cases, events, run_id, mode):
    # Wire observations come from this runner, never from downstream request headers.
    indexed = {e.get("fixture_id"): e for e in events if e["kind"] == "request" and e.get("fixture_id")}
    observations = [(name, case, "direct" if name == "direct" else "protected")
                    for business in BUSINESSES for name, case in cases[business.slug].items()
                    if isinstance(case, dict) and "fixture_id" in case]
    observations.extend((name, cases[name], "protected") for name in ("repeated_header", "unlabelled_record"))
    observations.extend((actor, case, "protected")
                        for (actor, _, _), case in zip(REQUEST_CASES, cases["request_observations"], strict=True))
    observations.extend((phase, case, "protected") for phase, case in
                        zip(("progression-fingerprint", "progression-probe", "progression-repeat"), cases["progression"], strict=True))
    records = []
    for name, case, arm in observations:
        request_event = indexed.get(case["fixture_id"])
        if arm == "protected" and not request_event:
            raise AssertionError(f"Missing proxy transaction for {name}")
        label = ("legitimate" if name in ("other_route", "clean-control") else
                 "request-indicator" if name.endswith("-indicator") or name.startswith("progression-") else
                 "unlabelled-control" if name == "unlabelled_record" else "disclosure-fixture")
        records.append({
            **case, "kind": "wire", "run_id": run_id, "data_plane": mode, "arm": arm,
            "trace_id": request_event["trace_id"] if request_event else case["fixture_id"],
            "label": label, "case": name, "route": case["path"],
        })
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--openrouter", action="store_true")
    parser.add_argument("--observe", action="store_true", help="record outcomes without enforcing post-fix assertions")
    parser.add_argument("--event-dir", type=Path, help="write the evaluated run to the live dashboard journal directory")
    parser.add_argument("--payload-dir", type=Path, help="private directory for optional raw fixture payload archives")
    args = parser.parse_args()
    if args.event_dir:
        args.event_dir = args.event_dir.resolve()
        args.event_dir.mkdir(parents=True, exist_ok=True)
    if args.payload_dir:
        args.payload_dir = args.payload_dir.resolve()
        if args.event_dir and args.payload_dir == args.event_dir:
            parser.error("--payload-dir must be separate from --event-dir")
    run_id = "evaluation-" + uuid4().hex
    if args.openrouter:
        load_env(str(ROOT.parent))
    result = {"timestamp_utc": datetime.now(timezone.utc).isoformat(), "envoy": ENVOY_IMAGE, "data_planes": {}}
    with Service(0) as service:
        worker = Thread(target=service.serve_forever, daemon=True)
        worker.start()
        try:
            for mode in ("revproxy", "extproc"):
                print(f"Evaluating {mode}", flush=True)
                with proxy(args.engine.resolve(), mode, service.server_port, run_id, args.event_dir, args.payload_dir) as (port, admin, events):
                    cases = run_wire(service, port, admin)
                    if mode == "extproc" and args.openrouter:
                        tasks = []
                        for business in BUSINESSES:
                            for arm, endpoint in (("direct", service.server_port), ("protected", port)):
                                status, _, payload = request(endpoint, f"/{business.slug}/service")
                                tasks.append((business, arm, status, payload))
                        with ThreadPoolExecutor(max_workers=3) as pool:
                            result["openrouter"] = list(pool.map(lambda task: customer_task(*task), tasks))
                    records = [json.loads(line) for line in events.read_text().splitlines()]
                    result["data_planes"][mode] = {"cases": cases, "events": records}
                if args.event_dir:
                    wire_events = record_wire_events(cases, records, run_id, mode)
                    with events.open("a") as journal:
                        journal.writelines(json.dumps(event) + "\n" for event in wire_events)
        finally:
            service.shutdown()
            worker.join()
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    if not args.observe:
        check(result)
    print(f"Wrote {args.out}", flush=True)


if __name__ == "__main__":
    main()
