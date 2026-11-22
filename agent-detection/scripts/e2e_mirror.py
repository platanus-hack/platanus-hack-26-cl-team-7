"""The attacker mirror lane end to end, against the local stack (scripts/stack_local.sh).

    uv run python scripts/e2e_mirror.py [--human-speed 1.0] [--report run/e2e-report.json]

Stops any running stack, deletes the router's keys, spool and patches from earlier runs (so
127.0.0.1 starts unflagged), starts every service, runs the checks and stops the stack again.
Benign requests only: the one flag is GET /.env, which R3 marks critical. The planted flaws on the
twin are covered by tests/test_twin_*.py and tests/test_mirror_tap_e2e.py, not here.

Checks: 1 routing, 2 recording, 3 real data untouched, 4 follow keys, 5 lane parity, 6 performance,
7 humans, 8 resilience, 9 swarm link. Each prints PASS or FAIL with its evidence; the report holds
them all. Exit code 0 when every check passes, 1 when one fails, 2 when the stack fails.
Loopback only: the clients are 127.0.0.1 (flagged) and ::1 (clean, or following a twin cookie).
It takes about seven minutes: the human replay keeps the sessions' recorded pace.
"""

from __future__ import annotations

import argparse
import contextlib
import dataclasses
import json
import os
import secrets
import sys
import time

from e2e import ops, parity, routing, stack, swarm
from e2e.context import Ctx
from e2e.wire import NET_ERRORS, Stream, sentinel

READY_WAIT = 30.0
EXIT_FAILED, EXIT_STACK = 1, 2


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="scripts/e2e_mirror.py", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--human-speed", type=float, default=1.0,
                        help="replay pace of the human sessions (1.0 = as recorded)")
    parser.add_argument("--report", default=str(stack.RUN / "e2e-report.json"))
    args = parser.parse_args(argv)
    os.chdir(stack.ROOT)
    stack.stop()
    print(f"router state reset: {stack.reset_router_state() or 'nothing to delete'}", flush=True)
    ctx = Ctx(run=secrets.token_hex(4), token="", stream=Stream())
    started = time.time()
    try:
        stack.start()
        ctx.token = (stack.RUN / "sentinel.token").read_text().strip()
        _wait_for_sentinel()
        _run(ctx, args.human_speed)
    except stack.StackError as err:
        print(f"stack failed: {err}", file=sys.stderr)
        return EXIT_STACK
    finally:
        ctx.stream.stop.set()
        stack.stop()
    report = {
        "run": ctx.run, "seconds": round(time.time() - started, 1),
        "checks": [dataclasses.asdict(result) for result in ctx.results],
        "numbers": ctx.numbers,
    }
    with open(args.report, "w", encoding="utf-8") as out:
        json.dump(report, out, indent=2)
    passed = sum(result.passed for result in ctx.results)
    print(f"{passed}/{len(ctx.results)} checks passed; report {args.report}", flush=True)
    return 0 if passed == len(ctx.results) else EXIT_FAILED


def _run(ctx: Ctx, human_speed: float) -> None:
    ctx.stream.start()
    routing.run(ctx)
    swarm.run(ctx)
    humans = ops.Humans(ctx.run, human_speed)
    humans.start()
    differences = parity.parity(ctx)
    parity.performance(ctx)
    parts = {"sentinel outage": ops.sentinel_outage(ctx), "idempotency": ops.idempotency(ctx)}
    print(f"waiting for the human replay ({len(humans.visits)} requests)", flush=True)
    humans.join()
    ops.humans_result(ctx, humans)
    parts = {"fail open": ops.fail_open(ctx), **parts}
    ops.resilience(ctx, parts)
    routing.accounting(ctx)
    parity.lane_check(ctx, differences)
    ctx.results.sort(key=lambda result: result.name)


def _wait_for_sentinel() -> None:
    deadline = time.monotonic() + READY_WAIT
    while time.monotonic() < deadline:
        with contextlib.suppress(*NET_ERRORS):
            if sentinel("GET", "/v1/health")[0] == 200:
                return
        time.sleep(0.2)
    raise stack.StackError("Sentinel did not answer GET /v1/health")


if __name__ == "__main__":
    sys.exit(main())
