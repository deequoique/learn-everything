from __future__ import annotations

import asyncio
import json
import queue
import threading
import time
import uuid
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from typing import Any, Literal

from starlette.responses import StreamingResponse

EventName = Literal["start", "progress", "delta", "citation", "result", "error", "done"]
VALID_EVENTS = {"start", "progress", "delta", "citation", "result", "error", "done"}


@dataclass(frozen=True)
class StreamEvent:
    event: EventName
    data: dict[str, Any]

    def __post_init__(self) -> None:
        if self.event not in VALID_EVENTS or "\r" in self.event or "\n" in self.event:
            raise ValueError("invalid SSE event")


def encode_sse(event: StreamEvent, event_id: str) -> bytes:
    if "\r" in event_id or "\n" in event_id:
        raise ValueError("invalid SSE id")
    data = json.dumps(event.data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event.event}\nid: {event_id}\ndata: {data}\n\n".encode()


def stream_response(
    kind: str,
    iterator_factory: Callable[[threading.Event], Iterable[StreamEvent]],
) -> StreamingResponse:
    request_id = str(uuid.uuid4())
    cancel = threading.Event()
    events: queue.Queue[StreamEvent | object] = queue.Queue(maxsize=1)
    sentinel = object()
    started = time.monotonic()

    def publish(item: StreamEvent | object) -> bool:
        while not cancel.is_set():
            try:
                events.put(item, timeout=0.1)
                return True
            except queue.Full:
                continue
        return False

    def worker() -> None:
        iterator: Iterator[StreamEvent] | None = None
        try:
            iterator = iter(iterator_factory(cancel))
            for event in iterator:
                if cancel.is_set() or not publish(event):
                    break
        except Exception:
            publish(StreamEvent("error", {"code": "STREAM_FAILED", "message": "生成失败，请稍后重试", "retryable": True}))
        finally:
            if iterator is not None:
                close = getattr(iterator, "close", None)
                if callable(close):
                    close()
            publish(sentinel)

    async def body():
        sequence = 0
        yield encode_sse(StreamEvent("start", {"request_id": request_id, "kind": kind}), f"{request_id}:{sequence}")
        thread = threading.Thread(target=worker, name=f"le-stream-{kind}", daemon=True)
        thread.start()
        terminal = False
        try:
            while True:
                item = await asyncio.to_thread(events.get)
                if item is sentinel:
                    break
                sequence += 1
                assert isinstance(item, StreamEvent)
                yield encode_sse(item, f"{request_id}:{sequence}")
                if item.event == "error":
                    terminal = True
                    break
            if not terminal and not cancel.is_set():
                sequence += 1
                elapsed = int((time.monotonic() - started) * 1000)
                yield encode_sse(StreamEvent("done", {"status": "completed", "elapsed_ms": elapsed}), f"{request_id}:{sequence}")
        finally:
            cancel.set()

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
