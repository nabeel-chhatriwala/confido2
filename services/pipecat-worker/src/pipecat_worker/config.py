from __future__ import annotations
import os
from dataclasses import dataclass

REQUIRED = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "INTERNAL_SVC_TOKEN",
    "PROVIDER_KEY_DEEPGRAM",
    "PROVIDER_KEY_OPENAI",
    "PROVIDER_KEY_ELEVENLABS",
]


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_service_role_key: str
    internal_svc_token: str
    provider_keys: dict[str, str]
    host: str
    port: int

    @classmethod
    def from_env(cls) -> "Config":
        for name in REQUIRED:
            if not os.environ.get(name):
                raise RuntimeError(f"Missing required env: {name}")
        return cls(
            supabase_url=os.environ["SUPABASE_URL"],
            supabase_service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
            internal_svc_token=os.environ["INTERNAL_SVC_TOKEN"],
            provider_keys={
                "deepgram": os.environ["PROVIDER_KEY_DEEPGRAM"],
                "openai": os.environ["PROVIDER_KEY_OPENAI"],
                "elevenlabs": os.environ["PROVIDER_KEY_ELEVENLABS"],
            },
            host=os.environ.get("HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", "8080")),
        )
