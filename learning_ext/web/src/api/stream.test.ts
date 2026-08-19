import { describe, expect, it, vi } from "vitest";
import { decodeSseChunks, decodeSseText, streamJson, SseParser, StreamProtocolError } from "./stream";
import { initialStreamState, streamReducer } from "./streamReducer";

describe("SSE protocol", () => {
  it("decodes CRLF records, multi-line data, and split UTF-8 bytes", () => {
    const source = "event: start\r\nid: req-1\r\ndata: {\"request_id\":\"req-1\",\"task\":\"chat\"}\r\n\r\nevent: delta\r\ndata: {\"text\":\"你好\"}\r\n\r\nevent: done\r\ndata: {\"status\":\"completed\"}\r\n\r\n";
    const bytes = new TextEncoder().encode(source);
    const events = decodeSseChunks(Array.from(bytes, (byte) => new Uint8Array([byte])));
    expect(events.map((event) => event.type)).toEqual(["start", "delta", "done"]);
    expect(events[1]).toMatchObject({ type: "delta", text: "你好" });
  });

  it("handles comments, combined records, and a split record boundary", () => {
    const parser = new SseParser();
    expect(parser.push(": keepalive\n\nevent: delta\ndata: {\"text\":\"a\"}\n\n" )).toHaveLength(1);
    expect(parser.push("event: delta\ndata: {\"text\":\"b\"}\n")).toHaveLength(0);
    expect(parser.push("\n")).toHaveLength(1);
    expect(decodeSseText("event: error\ndata: {\"code\":\"NO\",\"message\":\"失败\"}\n\n")[0]).toMatchObject({ type: "error", error: { code: "NO" } });
  });

  it("rejects malformed JSON and unknown events", () => {
    expect(() => decodeSseText("event: delta\ndata: nope\n\n")).toThrow(StreamProtocolError);
    expect(() => decodeSseText("event: mystery\ndata: {}\n\n")).toThrow(StreamProtocolError);
  });

  it("forwards AbortSignal and cancels the reader when the caller aborts", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(async () => undefined);
    const read = vi.fn(() => new Promise<never>((_, reject) => {
      const rejectAbort = () => reject(new DOMException("已取消", "AbortError"));
      if (controller.signal.aborted) rejectAbort();
      else controller.signal.addEventListener("abort", rejectAbort, { once: true });
    }));
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal);
      return { ok: true, body: { getReader: () => ({ read, cancel }) } } as unknown as Response;
    }));
    const running = streamJson("/api/chat/stream", { message: "问题" }, { signal: controller.signal, onEvent: () => undefined });
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uploads FormData without overriding its multipart boundary", async () => {
    const cancel = vi.fn(async () => undefined);
    const encoded = new TextEncoder().encode("event: start\ndata: {\"request_id\":\"r\"}\n\nevent: done\ndata: {\"status\":\"completed\"}\n\n");
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.body).toBeInstanceOf(FormData);
      expect(new Headers(init.headers).has("Content-Type")).toBe(false);
      return { ok: true, body: { getReader: () => ({ read: async () => reads++ === 0 ? { done: false, value: encoded } : { done: true }, cancel }) } } as unknown as Response;
    }));
    const form = new FormData();
    form.append("file", new Blob(["content"]), "lesson.txt");

    await streamJson("/api/library/index/stream", form, { onEvent: () => undefined });

    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects an application error event instead of treating it as success", async () => {
    const encoded = new TextEncoder().encode("event: start\ndata: {\"request_id\":\"r\"}\n\nevent: error\ndata: {\"code\":\"FAILED\",\"message\":\"失败\",\"retryable\":false}\n\n");
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body: { getReader: () => ({ read: async () => reads++ === 0 ? { done: false, value: encoded } : { done: true }, cancel: async () => undefined }) } } as unknown as Response)));

    await expect(streamJson("/api/chat/stream", {}, { onEvent: () => undefined })).rejects.toThrow("失败");
  });
});

describe("stream reducer", () => {
  it("concatenates deltas, de-duplicates citations, and keeps the terminal state", () => {
    let state = streamReducer(initialStreamState, { type: "start", requestId: "r" });
    state = streamReducer(state, { type: "delta", text: "第" });
    state = streamReducer(state, { type: "delta", text: "一步" });
    const citation = { id: "c1", title: "资料", excerpt: "片段", page: null, resourceId: null };
    state = streamReducer(state, { type: "citation", citation });
    state = streamReducer(state, { type: "citation", citation });
    state = streamReducer(state, { type: "done", status: "completed" });
    state = streamReducer(state, { type: "delta", text: "不应追加" });
    expect(state.text).toBe("第一步");
    expect(state.citations).toHaveLength(1);
    expect(state.phase).toBe("completed");
  });
});
