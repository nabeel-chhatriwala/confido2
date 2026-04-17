from __future__ import annotations
import json as _json
from datetime import datetime, timezone

import structlog
from fastapi import WebSocket, WebSocketDisconnect

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineTask
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketTransport,
    FastAPIWebsocketParams,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.frames.frames import TTSSpeakFrame

from .config import Config
from .token import verify_session_token, TokenInvalid
from .session import build_pipeline_single_stack
from .events import EventBatcher
from .transcript_capture import TranscriptCapture
from .supabase_client import make_client

log = structlog.get_logger()


async def handle_ws(ws: WebSocket, cfg: Config) -> None:
    """Twilio Media Streams WS handler.

    Twilio opens the WS without passing URL query parameters; the token is passed
    as a <Parameter> in the <Stream> TwiML element, which arrives in the `start`
    event under `start.customParameters.token`.
    """
    await ws.accept()

    # Twilio sends: {"event":"connected"}, then {"event":"start", "start":{...}}
    stream_sid = ""
    call_sid_from_twilio = ""
    token = ""
    try:
        # Loop until we see the start event (at most a few frames in).
        for _ in range(5):
            msg = await ws.receive_text()
            evt = _json.loads(msg)
            if evt.get("event") == "start":
                stream_sid = evt["start"].get("streamSid", "")
                call_sid_from_twilio = evt["start"].get("callSid", "")
                token = (evt["start"].get("customParameters") or {}).get("token", "")
                break
    except Exception as e:
        log.warning("start_frame_parse_failed", err=str(e))
        await ws.close(code=4400)
        return

    log.info(
        "ws_start",
        stream_sid=stream_sid,
        call_sid=call_sid_from_twilio,
        token_len=len(token),
        token_dots=token.count("."),
    )

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
        log.error("call_not_found", call_id=payload.call_id)
        await ws.close(code=4404)
        return

    snapshot = call_row.data["agent_version_snapshot"]
    batcher = EventBatcher(supabase, call_id=payload.call_id)
    batcher.start()

    try:
        built = build_pipeline_single_stack(snapshot, cfg.provider_keys)
    except Exception as e:
        log.error("pipeline_build_failed", err=str(e))
        supabase.table("calls").update({"status": "failed", "end_reason": "error"}).eq(
            "id", payload.call_id
        ).execute()
        await ws.close(code=4500)
        return

    serializer = TwilioFrameSerializer(
        stream_sid=stream_sid,
        call_sid=call_sid_from_twilio,
    )
    transport = FastAPIWebsocketTransport(
        websocket=ws,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=serializer,
        ),
    )

    context = LLMContext(messages=[{"role": "system", "content": built.system_prompt}])
    agg = LLMContextAggregatorPair(context)

    user_turns: list[str] = []
    assistant_turns: list[str] = []

    def _on_user(text: str) -> None:
        user_turns.append(text)
        batcher.append("transcription", {"role": "user", "text": text})

    def _on_assistant(text: str) -> None:
        assistant_turns.append(text)

    capture = TranscriptCapture(on_user_text=_on_user, on_assistant_text=_on_assistant)

    pipeline = Pipeline(
        [
            transport.input(),
            built.stt,
            capture,
            agg.user(),
            built.llm,
            built.tts,
            transport.output(),
            agg.assistant(),
        ]
    )

    task = PipelineTask(pipeline)
    runner = PipelineRunner()

    end_reason = "caller_hangup"

    if built.first_message:
        import asyncio

        async def _speak_first() -> None:
            await asyncio.sleep(0.3)
            await task.queue_frames([TTSSpeakFrame(text=built.first_message)])

        asyncio.create_task(_speak_first())

    try:
        await runner.run(task)
    except WebSocketDisconnect:
        log.info("ws_disconnected", call_id=payload.call_id)
    except Exception as e:
        log.exception("pipeline_error", err=str(e))
        end_reason = "error"
    finally:
        await batcher.close()
        final_status = "failed" if end_reason == "error" else "completed"
        transcript = {
            "turns": [
                *[{"role": "user", "content": t} for t in user_turns],
                *[{"role": "assistant", "content": t} for t in assistant_turns],
            ],
            "text": " ".join(user_turns + assistant_turns),
        }
        now_iso = datetime.now(timezone.utc).isoformat()
        for _ in range(3):
            try:
                supabase.table("calls").update(
                    {
                        "status": final_status,
                        "end_reason": end_reason,
                        "transcript_json": transcript,
                        "ended_at": now_iso,
                    }
                ).eq("id", payload.call_id).execute()
                break
            except Exception as e:
                log.warning("finalize_retry", err=str(e))
