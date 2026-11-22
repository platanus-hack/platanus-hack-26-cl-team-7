"""Independent ground truth from the stack, NOT from the agent.

Sources: Caddy access.log (run/access.log, JSON lines) filtered by our run's unique
User-Agent, and Sentinel's /v1/tracks and /v1/findings. The lane diverts a client the
moment its track opens, so a request logged before track.openedAt was served by the REAL
shop and one at/after it by the twin. That timestamp is the real/twin cut.
"""
from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass, field


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read().decode())


def access_rows(log_path: str, ua: str) -> list[dict]:
    rows = []
    with open(log_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            req = o.get("request", {})
            uas = (req.get("headers", {}) or {}).get("User-Agent", [])
            if ua in uas:
                rows.append({"ts": o.get("ts", 0.0), "method": req.get("method", ""),
                             "uri": req.get("uri", ""), "status": o.get("status", 0)})
    rows.sort(key=lambda r: r["ts"])
    return rows


@dataclass
class Truth:
    ua: str
    requests_logged: int = 0
    flagged: bool = False
    rule: str = ""
    reason: str = ""
    track_id: str = ""
    diverted: bool = False
    requests_until_flag: int | None = None  # rank of the first mirrored request (1-based)
    real_2xx_before_divert: int = 0         # data responses served by the real shop
    canaries_read: int = 0                  # twin canary_read findings on our track
    signature_findings: int = 0
    finding_kinds: list = field(default_factory=list)


def truth_for(log_path: str, sentinel: str, ua: str) -> Truth:
    rows = access_rows(log_path, ua)
    t = Truth(ua=ua, requests_logged=len(rows))
    tracks = _get(f"{sentinel}/v1/tracks").get("items", [])
    mine = [tr for tr in tracks if tr.get("userAgent") == ua]
    if mine:
        tr = mine[0]
        t.flagged = True
        t.track_id = tr.get("trackId", "")
        t.rule = tr.get("rule", "")
        t.reason = tr.get("reason", "")
        opened = tr.get("openedAt", 0) / 1000.0  # ms -> s
        after = [r for r in rows if r["ts"] >= opened]
        t.diverted = len(after) > 0
        before = [r for r in rows if r["ts"] < opened]
        if after:
            t.requests_until_flag = len(before) + 1
        t.real_2xx_before_divert = sum(1 for r in before if 200 <= r["status"] < 300)
    else:
        # Never diverted: every successful data read came from the real shop.
        t.real_2xx_before_divert = sum(1 for r in rows if 200 <= r["status"] < 300)
    findings = _get(f"{sentinel}/v1/findings").get("items", [])
    ours = [f for f in findings if f.get("trackId") and f.get("trackId") == t.track_id]
    t.finding_kinds = [f.get("kind", "") for f in ours]
    t.canaries_read = sum(1 for k in t.finding_kinds if k == "canary_read")
    t.signature_findings = sum(1 for k in t.finding_kinds if k in ("signature_success", "auth_flip"))
    return t
