"""Shared, dependency-free helpers for the Último Paso attacker profiles and
scoreboard. Uses only the Python standard library so nothing needs installing in
the VM. OpenRouter is reached over plain urllib; targets are reached the same
way (through the proxy for the protected arm, directly for the baseline)."""
from __future__ import annotations

import json
import math
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field


# --- target HTTP -----------------------------------------------------------

@dataclass
class HTTPResult:
    status: int
    headers: dict
    body: str
    error: str = ""

    def text(self) -> str:
        # Everything an attacker could read: headers + body.
        htxt = "\n".join(f"{k}: {v}" for k, v in self.headers.items())
        return htxt + "\n\n" + self.body


def http_request(base: str, method: str, path: str,
                 headers: dict | None = None, body: str | None = None,
                 timeout: float = 10.0) -> HTTPResult:
    url = base.rstrip("/") + "/" + path.lstrip("/")
    data = body.encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method.upper())
    req.add_header("User-Agent", (headers or {}).get("User-Agent", "scripted-poc/1.0"))
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return HTTPResult(r.status, dict(r.headers), r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return HTTPResult(e.code, dict(e.headers or {}), e.read().decode("utf-8", "replace"))
    except Exception as e:  # noqa: BLE001
        return HTTPResult(0, {}, "", error=str(e))


# --- OpenRouter chat -------------------------------------------------------

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def load_env(repo_root: str) -> None:
    """Load KEY=VALUE lines from <repo_root>/.env into os.environ if unset."""
    for cand in (os.path.join(repo_root, ".env"), os.path.join(repo_root, "..", ".env")):
        if os.path.exists(cand):
            with open(cand) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            return


@dataclass
class ChatResult:
    content: str
    tool_calls: list
    prompt_tokens: int = 0
    completion_tokens: int = 0
    error: str = ""


def openrouter_chat(messages: list, tools: list | None, model: str,
                    timeout: float = 60.0, temperature: float = 0.2) -> ChatResult:
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        return ChatResult("", [], error="OPENROUTER_API_KEY not set")
    payload = {"model": model, "messages": messages, "temperature": temperature}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    req = urllib.request.Request(
        OPENROUTER_URL, data=json.dumps(payload).encode(), method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "X-Title": "ultimo-paso-eval"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            obj = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return ChatResult("", [], error=f"http {e.code}: {e.read().decode()[:200]}")
    except Exception as e:  # noqa: BLE001
        return ChatResult("", [], error=str(e))
    choice = (obj.get("choices") or [{}])[0]
    msg = choice.get("message", {})
    usage = obj.get("usage", {})
    return ChatResult(
        content=msg.get("content") or "",
        tool_calls=msg.get("tool_calls") or [],
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
    )


# --- statistics ------------------------------------------------------------

def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float, float]:
    """Return (point, low, high) Wilson score interval for k successes of n."""
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
    return (p, max(0.0, center - half), min(1.0, center + half))


def pct(x: float) -> str:
    return f"{100*x:.0f}%"


@dataclass
class RunOutcome:
    """One attacker run against one target arm."""
    evidence_leaked: bool = False      # response oracle: canary/output reached attacker
    backend_executed: bool = False     # state oracle: vuln code path ran
    blocked_pre_exec: bool = False     # request blocked before reaching backend
    requests: int = 0
    leaked_bytes: int = 0
    declared_success: bool = False     # LLM agent said it succeeded
    gave_up: bool = False
    prompt_tokens: int = 0
    completion_tokens: int = 0
    benign_blocked: int = 0            # benign requests wrongly blocked (FP)
    benign_total: int = 0
    transcript: list = field(default_factory=list)
