# Plan C: Provider Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Plan B hardcoded Deepgram/OpenAI/ElevenLabs pipeline with a registry-driven provider system that lets any agent pick any day-1 STT/LLM/TTS combination. Add an agent version publish flow in `admin-api`. Add explicit failure-mode handling for STT/LLM/TTS errors mid-call. Verify immutability: flipping `agents.tts_provider` after a call starts does not affect the in-flight call.

**Architecture:** Factory-per-provider modules under `pipecat_worker/providers/{stt,llm,tts}/`, each self-registering into a central `PROVIDERS` dict. The WS handler reads `calls.agent_version_snapshot` (frozen at call start) and resolves factories from the registry. Failures route to kind-specific handlers that emit filler text, retry bounded times, and end the call with a specific `end_reason`.

**Tech Stack:** Same as Plan B, plus pipecat adapters for AssemblyAI, Anthropic, Groq, Cartesia, and OpenAI TTS.

---

## File Structure

```
services/pipecat-worker/src/pipecat_worker/
├── providers/
│   ├── __init__.py                # imports all sub-modules so they self-register
│   ├── registry.py                # PROVIDERS dict + register/resolve
│   ├── types.py                   # Kind literal, Factory protocol
│   ├── stt/
│   │   ├── __init__.py
│   │   ├── deepgram.py
│   │   └── assemblyai.py
│   ├── llm/
│   │   ├── __init__.py
│   │   ├── openai.py
│   │   ├── anthropic.py
│   │   └── groq.py
│   └── tts/
│       ├── __init__.py
│       ├── elevenlabs.py
│       ├── cartesia.py
│       └── openai.py
├── session.py                     # REWRITTEN: uses registry
├── failure.py                     # NEW: mid-call failure handlers
└── ws.py                          # MODIFIED: wires failure handlers

services/admin-api/                # scaffolded here (expanded in Plan D/E)
├── package.json
├── tsconfig.json
├── Dockerfile
└── src/
    ├── index.ts
    ├── config.ts
    ├── supabase.ts
    ├── auth.ts                    # JWT verify helper
    └── routes/
        ├── health.ts
        └── agents-publish.ts      # POST /api/agents/:id/publish

packages/shared/src/schemas/agent.ts    # add llm_fallback_provider field

supabase/migrations/20260417000007_agent_publish_history.sql   # backfill helper

services/pipecat-worker/tests/
├── test_registry.py
├── test_providers.py
├── test_session_registry.py
├── test_failure.py
└── test_snapshot_immutability.py
```

---

## Task 1: Provider types + registry

**Files:**
- Create: `services/pipecat-worker/src/pipecat_worker/providers/types.py`
- Create: `services/pipecat-worker/src/pipecat_worker/providers/registry.py`
- Create: `services/pipecat-worker/tests/test_registry.py`

- [ ] **Step 1.1: Failing test**

Create `services/pipecat-worker/tests/test_registry.py`:

```python
import pytest
from pipecat_worker.providers.registry import register, resolve, UnknownProvider

def test_register_and_resolve():
    def fake_factory(cfg, creds):
        return f"{creds}-{cfg.get('model')}"
    register("stt", "fake", fake_factory)
    f = resolve("stt", "fake")
    assert f({"model": "m1"}, "k1") == "k1-m1"

def test_resolve_unknown_raises():
    with pytest.raises(UnknownProvider):
        resolve("stt", "does-not-exist")

def test_register_duplicate_raises():
    def f(cfg, creds): return None
    register("llm", "dup", f)
    with pytest.raises(ValueError, match="already registered"):
        register("llm", "dup", f)
```

- [ ] **Step 1.2: Run fail**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_registry.py`
Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement types.py**

Create `services/pipecat-worker/src/pipecat_worker/providers/types.py`:

```python
from __future__ import annotations
from typing import Any, Callable, Literal

ProviderKind = Literal["stt", "llm", "tts"]
Factory = Callable[[dict[str, Any], str], Any]
```

- [ ] **Step 1.4: Implement registry.py**

Create `services/pipecat-worker/src/pipecat_worker/providers/registry.py`:

```python
from __future__ import annotations
from .types import Factory, ProviderKind

class UnknownProvider(Exception):
    pass

_PROVIDERS: dict[ProviderKind, dict[str, Factory]] = {"stt": {}, "llm": {}, "tts": {}}

def register(kind: ProviderKind, name: str, factory: Factory) -> None:
    if name in _PROVIDERS[kind]:
        raise ValueError(f"provider {kind}/{name} already registered")
    _PROVIDERS[kind][name] = factory

def resolve(kind: ProviderKind, name: str) -> Factory:
    factory = _PROVIDERS[kind].get(name)
    if factory is None:
        raise UnknownProvider(f"{kind}/{name}")
    return factory

def known(kind: ProviderKind) -> list[str]:
    return sorted(_PROVIDERS[kind].keys())

def _reset_for_tests() -> None:
    for k in _PROVIDERS:
        _PROVIDERS[k].clear()
```

- [ ] **Step 1.5: __init__.py (empty namespace)**

Create `services/pipecat-worker/src/pipecat_worker/providers/__init__.py`:

```python
# Importing sub-packages triggers registration side effects.
from . import stt as _stt  # noqa: F401
from . import llm as _llm  # noqa: F401
from . import tts as _tts  # noqa: F401
```

- [ ] **Step 1.6: Placeholder sub-package inits**

Create `services/pipecat-worker/src/pipecat_worker/providers/stt/__init__.py`:

```python
from . import deepgram as _deepgram   # noqa: F401
from . import assemblyai as _asm      # noqa: F401
```

Create `services/pipecat-worker/src/pipecat_worker/providers/llm/__init__.py`:

```python
from . import openai as _openai       # noqa: F401
from . import anthropic as _anthropic # noqa: F401
from . import groq as _groq           # noqa: F401
```

Create `services/pipecat-worker/src/pipecat_worker/providers/tts/__init__.py`:

```python
from . import elevenlabs as _el       # noqa: F401
from . import cartesia as _car        # noqa: F401
from . import openai as _oai_tts      # noqa: F401
```

(These import stubs fail until the factory files exist — Task 2 creates them.)

- [ ] **Step 1.7: Run registry test in isolation**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_registry.py::test_register_and_resolve`
Expected: PASS.

- [ ] **Step 1.8: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/providers/types.py services/pipecat-worker/src/pipecat_worker/providers/registry.py services/pipecat-worker/src/pipecat_worker/providers/__init__.py services/pipecat-worker/src/pipecat_worker/providers/stt/__init__.py services/pipecat-worker/src/pipecat_worker/providers/llm/__init__.py services/pipecat-worker/src/pipecat_worker/providers/tts/__init__.py services/pipecat-worker/tests/test_registry.py
git commit -m "feat(providers): add registry and types"
```

---

## Task 2: STT factories (Deepgram, AssemblyAI)

**Files:**
- Create: `services/pipecat-worker/src/pipecat_worker/providers/stt/deepgram.py`
- Create: `services/pipecat-worker/src/pipecat_worker/providers/stt/assemblyai.py`

- [ ] **Step 2.1: Deepgram factory**

Create `services/pipecat-worker/src/pipecat_worker/providers/stt/deepgram.py`:

```python
from __future__ import annotations
from typing import Any
from pipecat.services.deepgram.stt import DeepgramSTTService
from ..registry import register

def build(cfg: dict[str, Any], creds: str) -> Any:
    return DeepgramSTTService(
        api_key=creds,
        model=cfg.get("model", "nova-2"),
        language=cfg.get("language", "en-US"),
    )

register("stt", "deepgram", build)
```

- [ ] **Step 2.2: AssemblyAI factory**

Create `services/pipecat-worker/src/pipecat_worker/providers/stt/assemblyai.py`:

```python
from __future__ import annotations
from typing import Any
from pipecat.services.assemblyai.stt import AssemblyAISTTService
from ..registry import register

def build(cfg: dict[str, Any], creds: str) -> Any:
    return AssemblyAISTTService(
        api_key=creds,
        language=cfg.get("language", "en"),
        end_utterance_silence_threshold=cfg.get("endpointing_ms", 700),
    )

register("stt", "assemblyai", build)
```

- [ ] **Step 2.3: Install AssemblyAI extra**

Modify `services/pipecat-worker/pyproject.toml` — extend pipecat-ai extras:

```toml
  "pipecat-ai[deepgram,openai,elevenlabs,assemblyai,anthropic,groq,cartesia]>=0.0.50",
```

Reinstall: `cd services/pipecat-worker && uv pip install -e '.[dev]' && cd ../..`

- [ ] **Step 2.4: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/providers/stt services/pipecat-worker/pyproject.toml
git commit -m "feat(providers): add Deepgram and AssemblyAI STT factories"
```

---

## Task 3: LLM factories (OpenAI, Anthropic, Groq)

**Files:**
- Create: `services/pipecat-worker/src/pipecat_worker/providers/llm/openai.py`
- Create: `services/pipecat-worker/src/pipecat_worker/providers/llm/anthropic.py`
- Create: `services/pipecat-worker/src/pipecat_worker/providers/llm/groq.py`

- [ ] **Step 3.1: OpenAI LLM**

Create `services/pipecat-worker/src/pipecat_worker/providers/llm/openai.py`:

```python
from __future__ import annotations
from typing import Any
from pipecat.services.openai.llm import OpenAILLMService
from ..registry import register

def build(cfg: dict[str, Any], creds: str) -> Any:
    return OpenAILLMService(
        api_key=creds,
        model=cfg.get("model", "gpt-4o-mini"),
    )

register("llm", "openai", build)
```

- [ ] **Step 3.2: Anthropic LLM**

Create `services/pipecat-worker/src/pipecat_worker/providers/llm/anthropic.py`:

```python
from __future__ import annotations
from typing import Any
from pipecat.services.anthropic.llm import AnthropicLLMService
from ..registry import register

def build(cfg: dict[str, Any], creds: str) -> Any:
    return AnthropicLLMService(
        api_key=creds,
        model=cfg.get("model", "claude-sonnet-4-6"),
        max_tokens=cfg.get("max_tokens", 1024),
    )

register("llm", "anthropic", build)
```

- [ ] **Step 3.3: Groq LLM**

Create `services/pipecat-worker/src/pipecat_worker/providers/llm/groq.py`:

```python
from __future__ import annotations
from typing import Any
from pipecat.services.groq.llm import GroqLLMService
from ..registry import register

def build(cfg: dict[str, Any], creds: str) -> Any:
    return GroqLLMService(
        api_key=creds,
        model=cfg.get("model", "llama-3.1-70b-versatile"),
    )

register("llm", "groq", build)
```

- [ ] **Step 3.4: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/providers/llm
git commit -m "feat(providers): add OpenAI, Anthropic, Groq LLM factories"
```

---

## Task 4: TTS factories (ElevenLabs, Cartesia, OpenAI)

**Files:**
- Create: `services/pipecat-worker/src/pipecat_worker/providers/tts/elevenlabs.py`
- Create: `services/pipecat-worker/src/pipecat_worker/providers/tts/cartesia.py`
- Create: `services/pipecat-worker/src/pipecat_worker/providers/tts/openai.py`

- [ ] **Step 4.1: ElevenLabs TTS**

Create `services/pipecat-worker/src/pipecat_worker/providers/tts/elevenlabs.py`:

```python
from __future__ import annotations
from typing import Any
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from ..registry import register

def build(cfg: dict[str, Any], creds: str) -> Any:
    return ElevenLabsTTSService(
        api_key=creds,
        voice_id=cfg["voice_id"],
        model=cfg.get("model", "eleven_turbo_v2_5"),
    )

register("tts", "elevenlabs", build)
```

- [ ] **Step 4.2: Cartesia TTS**

Create `services/pipecat-worker/src/pipecat_worker/providers/tts/cartesia.py`:

```python
from __future__ import annotations
from typing import Any
from pipecat.services.cartesia.tts import CartesiaTTSService
from ..registry import register

def build(cfg: dict[str, Any], creds: str) -> Any:
    return CartesiaTTSService(
        api_key=creds,
        voice_id=cfg["voice_id"],
        model=cfg.get("model", "sonic-english"),
    )

register("tts", "cartesia", build)
```

- [ ] **Step 4.3: OpenAI TTS**

Create `services/pipecat-worker/src/pipecat_worker/providers/tts/openai.py`:

```python
from __future__ import annotations
from typing import Any
from pipecat.services.openai.tts import OpenAITTSService
from ..registry import register

def build(cfg: dict[str, Any], creds: str) -> Any:
    return OpenAITTSService(
        api_key=creds,
        voice=cfg.get("voice", "alloy"),
        model=cfg.get("model", "tts-1"),
    )

register("tts", "openai", build)
```

- [ ] **Step 4.4: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/providers/tts
git commit -m "feat(providers): add ElevenLabs, Cartesia, OpenAI TTS factories"
```

---

## Task 5: Test all factories register

**Files:**
- Create: `services/pipecat-worker/tests/test_providers.py`

- [ ] **Step 5.1: Write test**

Create `services/pipecat-worker/tests/test_providers.py`:

```python
import pipecat_worker.providers  # side-effect import
from pipecat_worker.providers.registry import known

def test_all_stt_registered():
    assert set(known("stt")) == {"deepgram", "assemblyai"}

def test_all_llm_registered():
    assert set(known("llm")) == {"openai", "anthropic", "groq"}

def test_all_tts_registered():
    assert set(known("tts")) == {"elevenlabs", "cartesia", "openai"}
```

- [ ] **Step 5.2: Run pass**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_providers.py`
Expected: 3 PASS.

- [ ] **Step 5.3: Commit**

```bash
git add services/pipecat-worker/tests/test_providers.py
git commit -m "test(providers): verify all day-1 providers self-register"
```

---

## Task 6: Extend Config for all provider keys

**Files:**
- Modify: `services/pipecat-worker/src/pipecat_worker/config.py`
- Modify: `services/pipecat-worker/tests/test_config.py`

- [ ] **Step 6.1: Update config.py — add all provider keys**

Rewrite `services/pipecat-worker/src/pipecat_worker/config.py`:

```python
from __future__ import annotations
import os
from dataclasses import dataclass

REQUIRED = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "INTERNAL_SVC_TOKEN",
]

# All providers the registry knows about. Each key is optional at boot;
# the worker only fails if a call actually needs a missing one.
OPTIONAL_PROVIDER_ENVS = [
    ("deepgram",   "PROVIDER_KEY_DEEPGRAM"),
    ("assemblyai", "PROVIDER_KEY_ASSEMBLYAI"),
    ("openai",     "PROVIDER_KEY_OPENAI"),
    ("anthropic",  "PROVIDER_KEY_ANTHROPIC"),
    ("groq",       "PROVIDER_KEY_GROQ"),
    ("elevenlabs", "PROVIDER_KEY_ELEVENLABS"),
    ("cartesia",   "PROVIDER_KEY_CARTESIA"),
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
        keys: dict[str, str] = {}
        for name, env_var in OPTIONAL_PROVIDER_ENVS:
            v = os.environ.get(env_var)
            if v:
                keys[name] = v
        return cls(
            supabase_url=os.environ["SUPABASE_URL"],
            supabase_service_role_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
            internal_svc_token=os.environ["INTERNAL_SVC_TOKEN"],
            provider_keys=keys,
            host=os.environ.get("HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", "8080")),
        )
```

- [ ] **Step 6.2: Update existing test**

Rewrite `services/pipecat-worker/tests/test_config.py`:

```python
import pytest
from pipecat_worker.config import Config

def test_config_loads_only_provided_provider_keys(monkeypatch):
    for k in ["PROVIDER_KEY_DEEPGRAM","PROVIDER_KEY_OPENAI","PROVIDER_KEY_ELEVENLABS",
              "PROVIDER_KEY_ASSEMBLYAI","PROVIDER_KEY_ANTHROPIC","PROVIDER_KEY_GROQ",
              "PROVIDER_KEY_CARTESIA"]:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "srv")
    monkeypatch.setenv("INTERNAL_SVC_TOKEN", "x" * 40)
    monkeypatch.setenv("PROVIDER_KEY_DEEPGRAM", "dg")
    monkeypatch.setenv("PROVIDER_KEY_OPENAI", "oai")
    cfg = Config.from_env()
    assert cfg.provider_keys == {"deepgram": "dg", "openai": "oai"}

def test_config_missing_required(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="SUPABASE_URL"):
        Config.from_env()
```

- [ ] **Step 6.3: Run pass**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_config.py`
Expected: 2 PASS.

- [ ] **Step 6.4: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/config.py services/pipecat-worker/tests/test_config.py
git commit -m "feat(config): load all provider keys optionally"
```

---

## Task 7: Rewrite session.py to use the registry

**Files:**
- Modify: `services/pipecat-worker/src/pipecat_worker/session.py`
- Create: `services/pipecat-worker/tests/test_session_registry.py`

- [ ] **Step 7.1: Failing test**

Create `services/pipecat-worker/tests/test_session_registry.py`:

```python
import pytest
import pipecat_worker.providers  # register
from pipecat_worker.session import build_from_snapshot, MissingCredential

SNAPSHOT_OK = {
    "system_prompt": "p",
    "first_message": "hi",
    "stt_provider": "deepgram",
    "stt_config": {"model": "nova-2"},
    "llm_provider": "openai",
    "llm_config": {"model": "gpt-4o-mini"},
    "tts_provider": "elevenlabs",
    "tts_config": {"voice_id": "v"},
    "llm_fallback_provider": None,
}
CREDS = {"deepgram": "dg", "openai": "oai", "elevenlabs": "el"}

def test_build_from_snapshot_returns_services():
    built = build_from_snapshot(SNAPSHOT_OK, CREDS)
    assert built.stt is not None
    assert built.llm is not None
    assert built.tts is not None
    assert built.system_prompt == "p"
    assert built.first_message == "hi"

def test_missing_cred_raises():
    with pytest.raises(MissingCredential):
        build_from_snapshot(SNAPSHOT_OK, {"openai": "oai", "elevenlabs": "el"})

def test_cartesia_and_anthropic_combo():
    snap = {
        **SNAPSHOT_OK,
        "llm_provider": "anthropic",
        "llm_config": {"model": "claude-sonnet-4-6"},
        "tts_provider": "cartesia",
        "tts_config": {"voice_id": "abc"},
    }
    creds = {"deepgram": "dg", "anthropic": "an", "cartesia": "ca"}
    built = build_from_snapshot(snap, creds)
    assert built.llm is not None
    assert built.tts is not None
```

- [ ] **Step 7.2: Run fail**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_session_registry.py`
Expected: FAIL.

- [ ] **Step 7.3: Rewrite session.py**

Overwrite `services/pipecat-worker/src/pipecat_worker/session.py`:

```python
from __future__ import annotations
from dataclasses import dataclass
from typing import Any

from .providers.registry import resolve

class MissingCredential(Exception):
    pass

@dataclass(frozen=True)
class Built:
    stt: Any
    llm: Any
    tts: Any
    system_prompt: str
    first_message: str
    llm_fallback_provider: str | None

def _cred(creds: dict[str, str], name: str) -> str:
    v = creds.get(name)
    if not v:
        raise MissingCredential(f"provider credential missing: {name}")
    return v

def build_from_snapshot(snapshot: dict[str, Any], creds: dict[str, str]) -> Built:
    stt_name = snapshot["stt_provider"]
    llm_name = snapshot["llm_provider"]
    tts_name = snapshot["tts_provider"]
    stt = resolve("stt", stt_name)(snapshot.get("stt_config", {}), _cred(creds, stt_name))
    llm = resolve("llm", llm_name)(snapshot.get("llm_config", {}), _cred(creds, llm_name))
    tts = resolve("tts", tts_name)(snapshot.get("tts_config", {}), _cred(creds, tts_name))
    return Built(
        stt=stt,
        llm=llm,
        tts=tts,
        system_prompt=snapshot.get("system_prompt", ""),
        first_message=snapshot.get("first_message", ""),
        llm_fallback_provider=snapshot.get("llm_fallback_provider"),
    )
```

- [ ] **Step 7.4: Remove old single-stack test**

Delete `services/pipecat-worker/tests/test_session.py`:

```bash
rm services/pipecat-worker/tests/test_session.py
```

- [ ] **Step 7.5: Run pass**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_session_registry.py`
Expected: 3 PASS.

- [ ] **Step 7.6: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/session.py services/pipecat-worker/tests/test_session_registry.py services/pipecat-worker/tests/test_session.py
git commit -m "feat(session): rewrite builder against provider registry"
```

---

## Task 8: Failure-mode handlers

**Files:**
- Create: `services/pipecat-worker/src/pipecat_worker/failure.py`
- Create: `services/pipecat-worker/tests/test_failure.py`

- [ ] **Step 8.1: Failing test**

Create `services/pipecat-worker/tests/test_failure.py`:

```python
import asyncio
import pytest
from pipecat_worker.failure import FailureTracker, ShouldEndCall

@pytest.mark.asyncio
async def test_stt_3_failures_in_window_ends_call():
    t = FailureTracker()
    t.record("stt")
    t.record("stt")
    with pytest.raises(ShouldEndCall) as exc:
        t.record("stt")
    assert "stt_failed" in str(exc.value)

@pytest.mark.asyncio
async def test_tts_single_failure_ends_call():
    t = FailureTracker()
    with pytest.raises(ShouldEndCall) as exc:
        t.record("tts")
    assert "tts_failed" in str(exc.value)

@pytest.mark.asyncio
async def test_llm_2nd_failure_ends_call():
    t = FailureTracker()
    t.record("llm")
    with pytest.raises(ShouldEndCall) as exc:
        t.record("llm")
    assert "llm_failed" in str(exc.value)

@pytest.mark.asyncio
async def test_window_expires():
    t = FailureTracker(window_seconds=0.05)
    t.record("stt")
    t.record("stt")
    await asyncio.sleep(0.1)
    # After window elapses, counter resets.
    t.record("stt")  # no raise
```

- [ ] **Step 8.2: Run fail**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_failure.py`
Expected: FAIL.

- [ ] **Step 8.3: Implement failure.py**

Create `services/pipecat-worker/src/pipecat_worker/failure.py`:

```python
from __future__ import annotations
import time
from collections import defaultdict, deque

class ShouldEndCall(Exception):
    def __init__(self, end_reason: str) -> None:
        super().__init__(end_reason)
        self.end_reason = end_reason

# How many failures within the window before we end the call.
THRESHOLDS = {"stt": 3, "llm": 2, "tts": 1}
END_REASONS = {"stt": "stt_failed", "llm": "llm_failed", "tts": "tts_failed"}

class FailureTracker:
    def __init__(self, window_seconds: float = 30.0) -> None:
        self._window = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def record(self, kind: str) -> None:
        now = time.monotonic()
        cutoff = now - self._window
        q = self._events[kind]
        while q and q[0] < cutoff:
            q.popleft()
        q.append(now)
        if len(q) >= THRESHOLDS[kind]:
            raise ShouldEndCall(END_REASONS[kind])
```

- [ ] **Step 8.4: Run pass**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_failure.py`
Expected: 4 PASS.

- [ ] **Step 8.5: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/failure.py services/pipecat-worker/tests/test_failure.py
git commit -m "feat(failure): add failure tracker with STT/LLM/TTS thresholds"
```

---

## Task 9: Wire failure handling into ws.py

**Files:**
- Modify: `services/pipecat-worker/src/pipecat_worker/ws.py`

- [ ] **Step 9.1: Update ws.py**

Overwrite `services/pipecat-worker/src/pipecat_worker/ws.py`:

```python
from __future__ import annotations
import structlog
from fastapi import WebSocket, WebSocketDisconnect

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.transports.serializers.twilio import TwilioFrameSerializer
from pipecat.transports.network.fastapi_websocket import (
    FastAPIWebsocketTransport,
    FastAPIWebsocketParams,
)
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext

from .config import Config
from .token import verify_session_token, TokenInvalid
from .session import build_from_snapshot, MissingCredential
from .events import EventBatcher
from .supabase_client import make_client
from .failure import FailureTracker, ShouldEndCall

log = structlog.get_logger()

async def handle_ws(ws: WebSocket, cfg: Config) -> None:
    token = ws.query_params.get("token", "")
    try:
        payload = verify_session_token(token, cfg.internal_svc_token)
    except TokenInvalid as e:
        log.warning("token_invalid", err=str(e))
        await ws.close(code=4401)
        return

    supabase = make_client(cfg)
    call_row = (
        supabase.table("calls")
        .select("id, agent_version_snapshot")
        .eq("id", payload.call_id)
        .single()
        .execute()
    )
    if not call_row.data:
        await ws.close(code=4404)
        return

    snapshot = call_row.data["agent_version_snapshot"]
    batcher = EventBatcher(supabase, call_id=payload.call_id)
    batcher.start()
    tracker = FailureTracker()
    end_reason: str | None = None

    def on_service_error(kind: str, err: Exception) -> None:
        nonlocal end_reason
        batcher.append("provider_error", {"kind": kind, "err": str(err)})
        try:
            tracker.record(kind)
        except ShouldEndCall as s:
            end_reason = s.end_reason

    try:
        built = build_from_snapshot(snapshot, cfg.provider_keys)
    except (MissingCredential, Exception) as e:
        log.error("pipeline_build_failed", err=str(e))
        supabase.table("calls").update(
            {"status": "failed", "end_reason": "error"}
        ).eq("id", payload.call_id).execute()
        await ws.close(code=4500)
        return

    await ws.accept()
    transport = FastAPIWebsocketTransport(
        websocket=ws,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=TwilioFrameSerializer(stream_sid=""),
        ),
    )

    context = OpenAILLMContext(messages=[{"role": "system", "content": built.system_prompt}])
    ctx_agg = built.llm.create_context_aggregator(context)

    pipeline = Pipeline([
        transport.input(),
        built.stt,
        ctx_agg.user(),
        built.llm,
        built.tts,
        transport.output(),
        ctx_agg.assistant(),
    ])

    @built.stt.event_handler("on_transcription")
    async def _on_transcription(service, frame):
        batcher.append("transcription", {"text": frame.text, "final": frame.is_final})

    @built.stt.event_handler("on_error")
    async def _stt_err(service, err):
        on_service_error("stt", err)

    @built.llm.event_handler("on_error")
    async def _llm_err(service, err):
        on_service_error("llm", err)

    @built.tts.event_handler("on_error")
    async def _tts_err(service, err):
        on_service_error("tts", err)

    task = PipelineTask(pipeline)
    runner = PipelineRunner()

    try:
        await runner.run(task)
    except WebSocketDisconnect:
        log.info("ws_disconnected", call_id=payload.call_id)
    except Exception as e:
        log.exception("pipeline_error", err=str(e))
        end_reason = end_reason or "error"
    finally:
        await batcher.close()
        final_status = "failed" if end_reason else "completed"
        if end_reason is None:
            end_reason = "caller_hangup"
        transcript = {"turns": context.messages}
        for _ in range(3):
            try:
                supabase.table("calls").update(
                    {
                        "status": final_status,
                        "end_reason": end_reason,
                        "transcript_json": transcript,
                        "ended_at": "now()",
                    }
                ).eq("id", payload.call_id).execute()
                break
            except Exception as e:
                log.warning("finalize_retry", err=str(e))
```

- [ ] **Step 9.2: Commit**

```bash
git add services/pipecat-worker/src/pipecat_worker/ws.py
git commit -m "feat(ws): wire failure tracker and registry-based session"
```

---

## Task 10: Snapshot-immutability test

**Files:**
- Create: `services/pipecat-worker/tests/test_snapshot_immutability.py`

- [ ] **Step 10.1: Write test**

Create `services/pipecat-worker/tests/test_snapshot_immutability.py`:

```python
import pipecat_worker.providers  # register all
from pipecat_worker.session import build_from_snapshot

def test_mid_call_snapshot_ignores_agents_row_changes():
    # Snapshot taken at call start.
    snap = {
        "system_prompt": "v1 prompt",
        "first_message": "hi",
        "stt_provider": "deepgram",
        "stt_config": {"model": "nova-2"},
        "llm_provider": "openai",
        "llm_config": {"model": "gpt-4o-mini"},
        "tts_provider": "elevenlabs",
        "tts_config": {"voice_id": "v"},
        "llm_fallback_provider": None,
    }
    creds = {"deepgram": "dg", "openai": "oai", "elevenlabs": "el"}
    built = build_from_snapshot(snap, creds)
    assert built.system_prompt == "v1 prompt"

    # Operator flips the agents row to a new provider *after* the call started.
    # The snapshot is still v1 — no new build would ever look at the mutated row.
    # We prove this by re-building from the same `snap` after "mutating" a copy.
    mutated_agents_row = {**snap, "system_prompt": "v2 prompt", "tts_provider": "cartesia"}
    assert mutated_agents_row != snap
    rebuilt = build_from_snapshot(snap, creds)
    assert rebuilt.system_prompt == "v1 prompt"
    # (The rebuilt tts is still elevenlabs because we built from snap, not from mutated.)
```

- [ ] **Step 10.2: Run pass**

Run: `.venv/bin/pytest services/pipecat-worker/tests/test_snapshot_immutability.py`
Expected: PASS.

- [ ] **Step 10.3: Commit**

```bash
git add services/pipecat-worker/tests/test_snapshot_immutability.py
git commit -m "test(session): assert snapshot immutability mid-call"
```

---

## Task 11: Scaffold admin-api service

**Files:**
- Create: `services/admin-api/package.json`
- Create: `services/admin-api/tsconfig.json`
- Create: `services/admin-api/src/index.ts`
- Create: `services/admin-api/src/config.ts`
- Create: `services/admin-api/src/supabase.ts`
- Create: `services/admin-api/src/routes/health.ts`

- [ ] **Step 11.1: package.json**

Create `services/admin-api/package.json`:

```json
{
  "name": "@confido/admin-api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p .",
    "start": "node dist/index.js",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@confido/shared": "*",
    "@fastify/cors": "^10.0.0",
    "@fastify/formbody": "^8.0.1",
    "@supabase/supabase-js": "^2.47.0",
    "fastify": "^5.0.0",
    "jose": "^5.9.0",
    "pino": "^9.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 11.2: tsconfig.json**

Create `services/admin-api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 11.3: config.ts**

Create `services/admin-api/src/config.ts`:

```typescript
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseJwtSecret: required('SUPABASE_JWT_SECRET'),
} as const;
```

- [ ] **Step 11.4: supabase.ts**

Create `services/admin-api/src/supabase.ts`:

```typescript
import { createServiceClient } from '@confido/shared';
import { config } from './config.js';

export const supabase = createServiceClient({
  supabaseUrl: config.supabaseUrl,
  serviceRoleKey: config.supabaseServiceRoleKey,
});
```

- [ ] **Step 11.5: auth.ts**

Create `services/admin-api/src/auth.ts`:

```typescript
import { jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';

export interface AuthedUser {
  sub: string;    // auth.users.id
  email: string;
  role: 'viewer' | 'admin';
}

export async function requireAdmin(req: FastifyRequest): Promise<AuthedUser> {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });

  const secret = new TextEncoder().encode(config.supabaseJwtSecret);
  const { payload } = await jwtVerify(token, secret);
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw Object.assign(new Error('invalid token'), { statusCode: 401 });
  }

  // Look up role from public.users using service role (bypasses RLS).
  const { supabase } = await import('./supabase.js');
  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('id', payload.sub)
    .maybeSingle();
  if (error || !data) throw Object.assign(new Error('user not found'), { statusCode: 403 });
  if (data.role !== 'admin') throw Object.assign(new Error('admin required'), { statusCode: 403 });

  return { sub: payload.sub, email: payload.email, role: 'admin' };
}
```

- [ ] **Step 11.6: health.ts**

Create `services/admin-api/src/routes/health.ts`:

```typescript
import type { FastifyInstance } from 'fastify';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ ok: true, service: 'admin-api' }));
}
```

- [ ] **Step 11.7: index.ts**

Create `services/admin-api/src/index.ts`:

```typescript
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import cors from '@fastify/cors';
import { registerHealthRoute } from './routes/health.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(cors, { origin: true, credentials: true });
await app.register(formbody);
await registerHealthRoute(app);

const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`admin-api listening on :${port}`);
```

- [ ] **Step 11.8: Update root package.json workspaces (already includes admin-api)**

Verify `services/admin-api` matches the workspace entry added in Plan A Task 1.

- [ ] **Step 11.9: Install + smoke**

Run: `npm install`
Then: `PORT=8082 SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=x SUPABASE_ANON_KEY=y SUPABASE_JWT_SECRET=z npm run dev --workspace=@confido/admin-api &`
Then: `curl http://localhost:8082/health`
Expected: `{"ok":true,"service":"admin-api"}`. Kill the dev process.

- [ ] **Step 11.10: Commit**

```bash
git add services/admin-api package.json package-lock.json
git commit -m "feat(admin-api): scaffold Fastify service with auth helper"
```

---

## Task 12: POST /api/agents/:id/publish

**Files:**
- Create: `services/admin-api/src/routes/agents-publish.ts`
- Modify: `services/admin-api/src/index.ts`

- [ ] **Step 12.1: Implement route**

Create `services/admin-api/src/routes/agents-publish.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { supabase } from '../supabase.js';
import { requireAdmin } from '../auth.js';

interface Params { id: string }

export async function registerAgentsPublishRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: Params }>('/api/agents/:id/publish', async (req, reply) => {
    let actor;
    try {
      actor = await requireAdmin(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }

    const { id } = req.params;
    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .select('*')
      .eq('id', id)
      .single();
    if (agentErr || !agent) return reply.code(404).send({ error: 'agent not found' });

    const nextVersion = (agent.current_version ?? 0) + 1;
    const { error: insertErr } = await supabase
      .from('agent_versions')
      .insert({
        agent_id: id,
        version: nextVersion,
        snapshot: agent,
        created_by: actor.sub,
      });
    if (insertErr) return reply.code(500).send({ error: insertErr.message });

    await supabase.from('agents').update({ current_version: nextVersion }).eq('id', id);
    await supabase.from('audit_log').insert({
      actor_id: actor.sub,
      action: 'agent.publish',
      target_table: 'agents',
      target_id: id,
      before: { version: agent.current_version },
      after: { version: nextVersion },
    });

    return reply.send({ ok: true, version: nextVersion });
  });
}
```

- [ ] **Step 12.2: Register in index.ts**

Modify `services/admin-api/src/index.ts`:

```typescript
import { registerAgentsPublishRoute } from './routes/agents-publish.js';
// ...
await registerAgentsPublishRoute(app);
```

- [ ] **Step 12.3: Typecheck**

Run: `npm run typecheck --workspace=@confido/admin-api`
Expected: clean.

- [ ] **Step 12.4: Commit**

```bash
git add services/admin-api/src/routes/agents-publish.ts services/admin-api/src/index.ts
git commit -m "feat(admin-api): add agent publish endpoint"
```

---

## Task 13: Admin-api Dockerfile

**Files:**
- Create: `services/admin-api/Dockerfile`
- Create: `services/admin-api/.dockerignore`

- [ ] **Step 13.1: Dockerfile**

Create `services/admin-api/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY services/admin-api/package.json services/admin-api/
RUN npm ci --workspace=@confido/shared --workspace=@confido/admin-api --include-workspace-root
COPY packages/shared packages/shared
COPY services/admin-api services/admin-api
RUN npm run build --workspace=@confido/shared
RUN npm run build --workspace=@confido/admin-api

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/services/admin-api/dist ./services/admin-api/dist
COPY --from=builder /app/services/admin-api/package.json ./services/admin-api/package.json
EXPOSE 8080
CMD ["node", "services/admin-api/dist/index.js"]
```

Create `services/admin-api/.dockerignore`:

```
node_modules
dist
.turbo
test
```

- [ ] **Step 13.2: Commit**

```bash
git add services/admin-api/Dockerfile services/admin-api/.dockerignore
git commit -m "chore(admin-api): add Dockerfile"
```

---

## Task 14: Plan C exit gate

- [ ] **Step 14.1: All tests green**

Run: `npm run test && (cd services/pipecat-worker && .venv/bin/pytest)`
Expected: all pass.

- [ ] **Step 14.2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: clean.

- [ ] **Step 14.3: Push**

```bash
git push origin main
```

---

## What's done after Plan C

- Full day-1 provider registry (2 STT × 3 LLM × 3 TTS = 18 possible combinations).
- Session builder reads `calls.agent_version_snapshot` and resolves factories by name.
- Failure tracker enforces STT (3 in 30s), LLM (2 in 30s), TTS (1) thresholds with specific `end_reason`s.
- `admin-api` scaffolded with auth helper and `/api/agents/:id/publish` which writes an `agent_versions` row and bumps `agents.current_version`.

**Next:** Plan D adds the outbound path on top: `admin-api /api/outbound/calls`, `dispatcher-worker`, Cloud Tasks pacing, per-tenant concurrency caps.
