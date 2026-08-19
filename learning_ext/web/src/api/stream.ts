import { normalizeStreamEvent, streamEventTypes, type StreamEvent, type StreamEventType } from "./contracts";

export interface RawSseRecord {
  id?: string;
  event: string;
  data: string;
}

export class StreamProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamProtocolError";
  }
}

export function parseSseRecord(record: string): RawSseRecord | null {
  const fields = record.replace(/\r/g, "").split("\n");
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of fields) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "id") id = value;
    if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, id, data: data.join("\n") };
}

export class SseParser {
  private buffer = "";

  push(text: string): RawSseRecord[] {
    this.buffer += text;
    const records: RawSseRecord[] = [];
    let found = findRecordBoundary(this.buffer);
    while (found) {
      const record = parseSseRecord(this.buffer.slice(0, found.index));
      if (record) records.push(record);
      this.buffer = this.buffer.slice(found.index + found.length);
      found = findRecordBoundary(this.buffer);
    }
    return records;
  }

  flush(): RawSseRecord[] {
    const record = parseSseRecord(this.buffer);
    this.buffer = "";
    return record ? [record] : [];
  }
}

function findRecordBoundary(value: string): { index: number; length: number } | null {
  const candidates = ["\r\n\r\n", "\n\n", "\r\r"].map((separator) => ({ index: value.indexOf(separator), length: separator.length })).filter((candidate) => candidate.index >= 0);
  if (candidates.length === 0) return null;
  return candidates.sort((left, right) => left.index - right.index)[0];
}

function eventFromRecord(record: RawSseRecord): StreamEvent {
  if (!streamEventTypes.includes(record.event as StreamEventType)) throw new StreamProtocolError(`未知的 SSE 事件：${record.event}`);
  let data: unknown;
  try {
    data = JSON.parse(record.data) as unknown;
  } catch {
    throw new StreamProtocolError("SSE data 不是有效 JSON");
  }
  try {
    return normalizeStreamEvent(record.event, data);
  } catch (error) {
    if (error instanceof StreamProtocolError) throw error;
    throw new StreamProtocolError(error instanceof Error ? error.message : "SSE 事件格式无效");
  }
}

export function decodeSseText(text: string): StreamEvent[] {
  const parser = new SseParser();
  return [...parser.push(text), ...parser.flush()].map(eventFromRecord);
}

export function decodeSseChunks(chunks: Uint8Array[]): StreamEvent[] {
  const decoder = new TextDecoder("utf-8");
  const parser = new SseParser();
  const records: RawSseRecord[] = [];
  for (const chunk of chunks) records.push(...parser.push(decoder.decode(chunk, { stream: true })));
  records.push(...parser.push(decoder.decode()));
  records.push(...parser.flush());
  return records.map(eventFromRecord);
}

export async function streamJson(
  url: string,
  body: unknown,
  options: { signal?: AbortSignal; onEvent: (event: StreamEvent) => void },
): Promise<void> {
  const isForm = body instanceof FormData;
  const response = await fetch(url, {
    method: "POST",
    headers: isForm ? { Accept: "text/event-stream" } : { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: isForm ? body : JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok) throw new StreamProtocolError(`流式请求失败（${response.status}）`);
  if (!response.body) throw new StreamProtocolError("服务器没有返回流式内容");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = new SseParser();
  let terminal = false;
  let started = false;
  try {
    while (!terminal) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const text = decoder.decode(chunk.value, { stream: true });
      for (const record of parser.push(text)) {
        const event = eventFromRecord(record);
        if (!started && event.type !== "start") throw new StreamProtocolError("SSE 流必须以 start 事件开始");
        if (started && event.type === "start") throw new StreamProtocolError("SSE 流不能重复 start 事件");
        started = true;
        options.onEvent(event);
        if (event.type === "error") {
          terminal = true;
          throw new StreamProtocolError(event.error.message);
        }
        if (event.type === "done") {
          terminal = true;
          break;
        }
      }
    }
    if (!terminal) {
      const tail = decoder.decode();
      for (const record of [...parser.push(tail), ...parser.flush()]) {
        const event = eventFromRecord(record);
        if (!started && event.type !== "start") throw new StreamProtocolError("SSE 流必须以 start 事件开始");
        started = true;
        options.onEvent(event);
        if (event.type === "error") throw new StreamProtocolError(event.error.message);
        if (event.type === "done") terminal = true;
      }
    }
    if (!terminal) throw new StreamProtocolError("SSE 流在终止事件前结束");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
