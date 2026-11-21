# Evidence dashboard verification

Open Sentinel at `/ultimo-paso`. Replay loads the saved before-and-after exercise across Bruma Print Works, Litoral Freight, and Surco Rooms. Live reads new engine journals and adds the fixture runner's independent client and upstream observations when they share a transaction ID.

## Recorded replay

| Measurement | Original | Patched |
|---|---:|---:|
| First protected responses reaching the client with registered evidence | 2/6 | 0/6 |
| Contained retries reaching the upstream | 0/6 | 0/6 |
| Legitimate catalog requests that returned HTTP 200 | 8/8 | 8/8 |

Litoral's before-and-after trace shows the same HTTP status with different disclosure results. The dashboard links historic proxy events through known fixture actors and routes. Historic alert delivery and Firecrawl events were not recorded. The original [before](defense-before.json) and [after](defense-after.json) traces remain available.

## Fresh live run

The browser was subscribed to Live when the fixture runner started an isolated run through Envoy and the Go fallback. Sentinel indexed 45 transactions and joined 44 independent wire observations. The captured run includes 14 rule installations, 14 local alerts, and 14 webhook delivery observations. The webhook in this run was the engine's local receiver.

All six first protected receipts hit the upstream and withheld the registered evidence. All six contained repeats had zero upstream hits. Both unlabelled controls reached the client. The dashboard treats unverified live outcomes as unknown and labels fixture ground truth separately from the engine's observation.

## Tests

- Passed the 55 Sentinel and 35 web tests with `pnpm test`, plus `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
- Passed `go vet ./...`, `go test -count=1 ./...`, and the two-path HTTP fixture suite in Lima. The containment test checks expiry, actor and route scope, and continued enforcement after a failed webhook.
- Verified Chrome desktop and mobile layouts, deep links, the Litoral comparison, the live alert timeline, browser updates during a fresh run, and HTML downloads.
- Tested Firecrawl with mocked success, version match, search candidate, unresolved advisory, missing key, rate limit, and timeout. This environment had no configured Firecrawl credential. The live traces record that state and show curated fixture advisories with their sources.

See the [local setup and replay commands](../../README.md#evidence-dashboard).

## Payload archive and related-request verification

A fresh two-path fixture run captured 45 original proxy requests and recorded
50 independent wire observations. Each archive record matched the trace ID and
body digest shown by Sentinel. The stored request header was verified against
the inert test fixture. Raw headers and bodies were absent from the JSON export.

The dashboard returned 12 directed rule links and 12 directed inferred links.
The inferred links covered a fixture fingerprint followed by suspicious traffic
and a repeated detection pattern on another route. The unit tests also check
that stale, differently attributed, and labelled legitimate requests are excluded
from inferred groups. The archive tests verify byte preservation, private file
permissions, incomplete-body metadata, and refusal to overwrite a capture.
