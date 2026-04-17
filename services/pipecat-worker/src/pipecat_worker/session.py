from __future__ import annotations
from dataclasses import dataclass
from typing import Any

from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService


@dataclass(frozen=True)
class Built:
    stt: Any
    llm: Any
    tts: Any
    system_prompt: str
    first_message: str


def build_pipeline_single_stack(snapshot: dict[str, Any], creds: dict[str, str]) -> Built:
    """Plan B: hardcoded Deepgram / OpenAI / ElevenLabs. Plan C introduces the registry."""
    if snapshot.get("stt_provider") != "deepgram":
        raise ValueError("Plan B only supports deepgram STT")
    if snapshot.get("llm_provider") != "openai":
        raise ValueError("Plan B only supports openai LLM")
    if snapshot.get("tts_provider") != "elevenlabs":
        raise ValueError("Plan B only supports elevenlabs TTS")

    stt = DeepgramSTTService(
        api_key=creds["deepgram"],
        model=(snapshot.get("stt_config") or {}).get("model", "nova-2"),
    )
    llm = OpenAILLMService(
        api_key=creds["openai"],
        model=(snapshot.get("llm_config") or {}).get("model", "gpt-4o-mini"),
    )
    tts = ElevenLabsTTSService(
        api_key=creds["elevenlabs"],
        voice_id=(snapshot.get("tts_config") or {})["voice_id"],
    )
    return Built(
        stt=stt,
        llm=llm,
        tts=tts,
        system_prompt=snapshot.get("system_prompt") or "",
        first_message=snapshot.get("first_message") or "",
    )
