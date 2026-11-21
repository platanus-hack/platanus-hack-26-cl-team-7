"""Which lane a real-lane login POST takes. The lane endpoint sees only the URI; the tap sees every
login POST on both lanes, and reads its body:

- a twin-born username (one the twin gave out) puts the login on the track of that value, from any
  IP, and links the client's IP + User-Agent to it;
- a body that matches a virtual patch (a signature in the form, as an auth flip found it) opens a
  new track, as the lane does for a patched URI, and copies the session to the twin.

Any other login stays on the real lane.
"""

from __future__ import annotations

from dataclasses import dataclass
from email.message import Message

from mirror.exchange import body_form, login_username
from mirror.forwarded import Forwarded
from mirror.keys import twin_born_key
from mirror.lane import LaneRouter, patch_cause
from mirror.patches import PatchBook

LOGIN_METHOD = "POST"
# The login routes, with or without one trailing slash, as deploy/lanes.caddy sends them.
LOGIN_PATHS = frozenset({"/login", "/login/", "/api/session", "/api/session/"})


@dataclass(frozen=True, slots=True)
class Logins:
    lane: LaneRouter
    patches: PatchBook

    def track_of(
        self, method: str, path: str, headers: Message[str, str], body: bytes, request_id: str
    ) -> str:
        """The track this real-lane request moves to; "" when it stays real."""
        if method != LOGIN_METHOD or path not in LOGIN_PATHS:
            return ""
        try:
            fwd = Forwarded(
                request_id=request_id,
                method=method,
                path=path,
                query="",
                ip=headers.get("X-Client-Ip", ""),
                user_agent=headers.get("User-Agent", ""),
                cookie=headers.get("Cookie", ""),
                authorization=headers.get("Authorization", ""),
            )
        except ValueError:  # no client IP: Caddy always sets one, so this never came through it
            return ""
        content_type = headers.get("Content-Type", "")
        user = twin_born_key(login_username(content_type, body))
        known = [fwd.ip_ua_key] if user is None else [user, fwd.ip_ua_key]
        followed = self.lane.follow(known, [fwd.ip_ua_key], request_id)
        if followed is not None:
            return followed.track_id
        cause = patch_cause(self.patches.match(method, path, body_form(content_type, body)))
        return "" if cause is None else self.lane.open(fwd, cause, [fwd.ip_ua_key]).track_id
