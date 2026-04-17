from __future__ import annotations
import base64
import hmac
import hashlib
import json
import time
from dataclasses import dataclass


class TokenInvalid(Exception):
    pass


@dataclass(frozen=True)
class SessionPayload:
    call_id: str
    tenant_id: str
    agent_id: str


def _b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def verify_session_token(token: str, secret: str) -> SessionPayload:
    try:
        body_b64, mac_b64 = token.split(".")
    except ValueError as e:
        raise TokenInvalid("malformed") from e
    expected = hmac.new(secret.encode(), body_b64.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64d(mac_b64), expected):
        raise TokenInvalid("signature mismatch")
    try:
        body = json.loads(_b64d(body_b64))
    except Exception as e:
        raise TokenInvalid("body not JSON") from e
    if body.get("exp", 0) < int(time.time()):
        raise TokenInvalid("expired")
    try:
        return SessionPayload(
            call_id=body["call_id"],
            tenant_id=body["tenant_id"],
            agent_id=body["agent_id"],
        )
    except KeyError as e:
        raise TokenInvalid(f"missing field: {e}") from e
