import type { Citation, StreamEvent } from "./contracts";

export interface StreamState {
  phase: "idle" | "running" | "completed" | "cancelled" | "failed";
  requestId?: string;
  task?: string;
  progress?: { stage: string; completed: number; total?: number; message?: string };
  text: string;
  citations: Citation[];
  result?: unknown;
  error?: { code: string; message: string; retryable: boolean };
}

export const initialStreamState: StreamState = { phase: "idle", text: "", citations: [] };

export function streamReducer(state: StreamState, event: StreamEvent): StreamState {
  if ((state.phase === "completed" || state.phase === "cancelled" || state.phase === "failed") && event.type !== "start") return state;
  switch (event.type) {
    case "start":
      return { ...initialStreamState, phase: "running", requestId: event.requestId, task: event.task };
    case "progress":
      return { ...state, phase: "running", progress: { stage: event.stage, completed: event.completed, total: event.total, message: event.message } };
    case "delta":
      return { ...state, phase: "running", text: state.text + event.text };
    case "citation":
      return { ...state, phase: "running", citations: addCitation(state.citations, event.citation) };
    case "result":
      return { ...state, phase: "running", result: event.result };
    case "error":
      return { ...state, phase: "failed", error: event.error };
    case "done":
      return { ...state, phase: event.status === "cancelled" ? "cancelled" : event.status === "failed" ? "failed" : "completed" };
    default:
      return assertNever(event);
  }
}

function addCitation(citations: Citation[], citation: Citation): Citation[] {
  return citations.some((item) => item.id === citation.id) ? citations : [...citations, citation];
}

function assertNever(value: never): never {
  throw new Error(`未处理的流事件：${JSON.stringify(value)}`);
}
