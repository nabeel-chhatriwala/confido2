"""Captures final transcription frames and assistant-generated text to write to the DB."""
from __future__ import annotations
from typing import Callable

from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.frames.frames import Frame, TranscriptionFrame, LLMTextFrame


class TranscriptCapture(FrameProcessor):
    """Pass-through processor that records user (final) + assistant text for later persistence."""

    def __init__(self, on_user_text: Callable[[str], None], on_assistant_text: Callable[[str], None]) -> None:
        super().__init__()
        self._on_user_text = on_user_text
        self._on_assistant_text = on_assistant_text

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and frame.text:
            try:
                self._on_user_text(frame.text)
            except Exception:
                pass
        elif isinstance(frame, LLMTextFrame) and getattr(frame, "text", None):
            try:
                self._on_assistant_text(frame.text)
            except Exception:
                pass
        await self.push_frame(frame, direction)
