"""Secrets out of what the tap records and reports.

The twin's traffic goes to Sentinel, to its dashboard and to its fix proposals, and a real person
can be on it (a false positive, a real login moved to the mirror lane). A field whose name looks
like a secret keeps its name and loses its value, with a hint of the length:

    password=hunter2  ->  password=[redacted 7]        {"cvv": 123}  ->  {"cvv": "[redacted 3]"}

This holds in form text (the body and the query), in JSON (any depth, a truncated body too) and in
multipart parts, whatever the Content-Type says. A name is secret when, in lower case without
punctuation, it holds pass, pwd, secret, token, cvv, cvc, card, ccnum or apikey. Every other
field is untouched, so evidence stays useful: the SQL payload in a username is not a secret.
A secret field is redacted whatever it holds: a real password can look like an attack payload.
"""

from __future__ import annotations

import json
import re
from dataclasses import replace
from urllib.parse import unquote_plus

from mirror.exchange import Exchange

SECRET_NAME = re.compile(r"pass|pwd|secret|token|cvv|cvc|card|ccnum|apikey")
NOT_NAME = re.compile(r"[^a-z0-9]")
FORM_PAIR = re.compile(r"(?<![^&?;\s])([^&=?;\s\"'{}\[\]<>:,]{1,128})=([^&\s]*)")
JSON_KEY = re.compile(r'"((?:[^"\\]|\\.){1,64})"\s*:\s*')
JSON_STRING_END = re.compile(r'(?:[^"\\]|\\.)*(?:"|\Z)')
JSON_TOKEN = re.compile(r'"(?:[^"\\]|\\.)*(?:"|\Z)|[{}\[\]]')
JSON_SCALAR = re.compile(r"[^\s,}\]]*")
BOUNDARY = re.compile(r'boundary=(?:"([^"]+)"|([^;\s]+))', re.IGNORECASE)
PART_NAME = re.compile(r'(?<![\w-])name=(?:"([^"]*)"|([^;\s]*))', re.IGNORECASE)
PART_HEAD_END = re.compile(r"\r?\n\r?\n")
MARKUP = frozenset({"text/html", "application/xhtml+xml", "text/xml", "application/xml"})


def redacted(ex: Exchange) -> Exchange:
    """The exchange as the report and the finding evidence show it: no secret in the request body
    or the query. The twin's answer stays as it came, for the finding rules (canaries)."""
    return replace(
        ex, request_body=redact_body(ex.content_type, ex.request_body), query=redact_query(ex.query)
    )


def redact_body(content_type: str, body: bytes) -> bytes:
    """`body` with the value of every secret field replaced; the same bytes when none is."""
    text = body.decode("utf-8", "replace")
    kind = content_type.partition(";")[0].strip().lower()
    boundary = BOUNDARY.search(content_type)
    if kind == "multipart/form-data" and boundary:
        clean = _multipart(text, boundary.group(1) or boundary.group(2))
    else:
        clean = _json_fields(text)
        form = kind not in MARKUP and not clean.lstrip().startswith(("{", "["))
        clean = _form_fields(clean) if form else clean
    return body if clean == text else clean.encode()


def redact_query(query: str) -> str:
    return _form_fields(query)


def is_secret(name: str) -> bool:
    return SECRET_NAME.search(NOT_NAME.sub("", name.lower())) is not None


def _hint(size: int) -> str:
    return f"[redacted {size}]"


def _form_fields(text: str) -> str:
    def replace_pair(match: re.Match[str]) -> str:
        name, value = match.groups()
        if not is_secret(unquote_plus(name)):
            return match.group()
        return f"{name}={_hint(len(unquote_plus(value)))}"

    return FORM_PAIR.sub(replace_pair, text)


def _json_fields(text: str) -> str:
    """Replace the value, of any kind, of each secret key; keys inside other values are found."""
    out: list[str] = []
    pos = 0
    while (key := JSON_KEY.search(text, pos)) is not None:
        out.append(text[pos : key.end()])
        pos = key.end()
        if is_secret(_unescaped(key.group(1))):
            end = _value_end(text, pos)
            value = text[pos:end]
            if value:
                out.append(json.dumps(_hint(_size(value))))
                pos = end
    return "".join(out) + text[pos:]


def _value_end(text: str, start: int) -> int:
    if text.startswith('"', start):
        string = JSON_STRING_END.match(text, start + 1)
        return string.end() if string else len(text)
    if text.startswith(("{", "["), start):
        depth = 0
        for token in JSON_TOKEN.finditer(text, start):
            depth += {"{": 1, "[": 1, "}": -1, "]": -1}.get(token.group(), 0)
            if depth == 0:
                return token.end()
        return len(text)
    scalar = JSON_SCALAR.match(text, start)
    return scalar.end() if scalar else start


def _size(value: str) -> int:
    """The length of a JSON value without the quotes of a string."""
    if value.startswith('"'):
        value = value[1:]
        return len(value[:-1] if value.endswith('"') else value)
    return len(value)


def _unescaped(key: str) -> str:
    if "\\" not in key:
        return key
    try:
        return str(json.loads(f'"{key}"'))
    except ValueError:
        return key


def _multipart(text: str, boundary: str) -> str:
    """Each part named like a secret keeps its headers and gets a hint for its content."""
    delimiter = "--" + boundary
    parts = text.split(delimiter)
    for n, part in enumerate(parts):
        end = PART_HEAD_END.search(part)
        name = PART_NAME.search(part[: end.start()]) if end else None
        if end is None or name is None or not is_secret(name.group(1) or name.group(2) or ""):
            continue
        content = part[end.end() :]
        value = content.removesuffix("\r\n")
        if value:
            parts[n] = part[: end.end()] + _hint(len(value)) + content[len(value) :]
    return delimiter.join(parts)
