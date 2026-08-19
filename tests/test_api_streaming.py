import asyncio
import json
import threading

import pytest

from learning_ext.api.streaming import StreamEvent, encode_sse, stream_response


def test_sse_frame_contains_only_json_data_and_preserves_chinese():
    frame = encode_sse(StreamEvent("delta", {"text": "你好\n世界\\"}), "request:1").decode()

    assert frame.startswith("event: delta\nid: request:1\ndata: ")
    payload = json.loads(frame.split("data: ", 1)[1].strip())
    assert payload == {"text": "你好\n世界\\"}


@pytest.mark.parametrize("event_id", ["bad\nid", "bad\rid"])
def test_sse_rejects_frame_injection(event_id):
    with pytest.raises(ValueError):
        encode_sse(StreamEvent("done", {"status": "completed"}), event_id)


def test_sse_has_fixed_event_taxonomy():
    with pytest.raises(ValueError):
        StreamEvent("custom", {})


def test_closing_response_signals_worker_and_closes_owned_iterator():
    closed = threading.Event()

    def source(cancel):
        try:
            while not cancel.is_set():
                yield StreamEvent("delta", {"text": "x"})
        finally:
            closed.set()

    async def scenario():
        iterator = stream_response("chat", source).body_iterator
        assert b"event: start" in await anext(iterator)
        assert b"event: delta" in await anext(iterator)
        await iterator.aclose()
        assert await asyncio.to_thread(closed.wait, 1)

    asyncio.run(scenario())
