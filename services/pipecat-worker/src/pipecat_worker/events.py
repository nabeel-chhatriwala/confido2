from __future__ import annotations
import asyncio
import time
from typing import Any
import structlog

log = structlog.get_logger()


class EventBatcher:
    def __init__(
        self,
        supabase_client,
        call_id: str,
        batch_size: int = 10,
        flush_interval_ms: int = 500,
    ) -> None:
        self._client = supabase_client
        self._call_id = call_id
        self._buf: list[dict[str, Any]] = []
        self._batch_size = batch_size
        self._flush_interval_s = flush_interval_ms / 1000
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._closed = False

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    def append(self, kind: str, payload: dict[str, Any]) -> None:
        self._buf.append(
            {
                "call_id": self._call_id,
                "kind": kind,
                "payload": payload,
                "occurred_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )
        if len(self._buf) >= self._batch_size:
            asyncio.create_task(self._flush())

    async def _run(self) -> None:
        while not self._closed:
            await asyncio.sleep(self._flush_interval_s)
            await self._flush()

    async def _flush(self) -> None:
        async with self._lock:
            if not self._buf:
                return
            rows, self._buf = self._buf, []
        try:
            self._client.table("call_events").insert(rows).execute()
        except Exception as e:
            log.warning("event_batch_flush_failed", err=str(e), n=len(rows))

    async def close(self) -> None:
        self._closed = True
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._flush()
