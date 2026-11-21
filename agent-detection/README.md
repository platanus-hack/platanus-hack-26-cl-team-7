# Agent detection v0

Finds sessions that probe a site's endpoints. Caddy proxies the site and writes a JSON access log.
The engine reads that log, groups requests by IP + User-Agent and applies three rules:

- **R1 contract exits:** 5 or more requests outside the route list in 5 minutes.
- **R2 endpoint breadth:** more than 10 route patterns in 60 seconds.
- **R3 critical flag:** one request for a sensitive file or with a known attack payload.

Verdicts go to a webhook and show on a one-page dashboard.

Plan: `plans/ai-agent-detection-v0-plan.html`. Gates: `CONSTRAINTS.md`. Results: `eval/RESULTS.md`.

## Run

All commands run from this folder.

```bash
uv sync
make check                          # size, floor, lint, types, secrets, tests + changed-line coverage
make eval-ci                        # labeled replay, test-set lock, baseline
bash scripts/stack_local.sh start   # demo site :8081, Caddy :8080, dashboard :8090, engine
bash scripts/stack_local.sh stop
```

`deploy/docker-compose.yml` runs the same stack with Juice Shop as the demo site.
