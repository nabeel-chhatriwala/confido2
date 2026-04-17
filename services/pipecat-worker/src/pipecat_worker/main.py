from __future__ import annotations
from fastapi import FastAPI, WebSocket

from .config import Config
from .ws import handle_ws

cfg = Config.from_env()
app = FastAPI()


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "service": "pipecat-worker"}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await handle_ws(websocket, cfg)
