import { useEffect, useReducer, useRef, useState } from "react";
import { Bot, Send, Sparkles, Square, X } from "lucide-react";
import type { ConversationMessage } from "../../api/contracts";
import { streamJson } from "../../api/stream";
import { initialStreamState, streamReducer } from "../../api/streamReducer";
import { SafeMarkdown } from "../../components/Markdown";

interface NodeAssistantDrawerProps {
  nodeId: string;
  projectId: string;
  nodeTitle: string;
  onClose: () => void;
}

export function NodeAssistantDrawer({ nodeId, projectId, nodeTitle, onClose }: NodeAssistantDrawerProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [stream, dispatch] = useReducer(streamReducer, initialStreamState);
  const streamRef = useRef(stream);
  const controller = useRef<AbortController | null>(null);
  const [isStreaming, setStreaming] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        controller.current?.abort();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      controller.current?.abort();
    };
  }, [onClose]);
  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [messages, stream.text]);

  const close = () => {
    controller.current?.abort();
    onClose();
  };

  const submit = async (suggestion?: string) => {
    const question = (suggestion ?? prompt).trim();
    if (!question || isStreaming) return;
    setPrompt("");
    setMessages((current) => [...current, { role: "user", text: question, citations: [] }]);
    const next = new AbortController();
    controller.current = next;
    setStreaming(true);
    const startEvent = { type: "start" as const, requestId: `node-${nodeId}-${Date.now()}`, task: "node-assistant" };
    streamRef.current = streamReducer(initialStreamState, startEvent);
    dispatch(startEvent);
    try {
      await streamJson(
        "/api/chat/stream",
        {
          message: question,
          project_id: Number(projectId),
          node_id: Number(nodeId),
          file_ids: [],
        },
        {
          signal: next.signal,
          onEvent: (event) => {
            streamRef.current = streamReducer(streamRef.current, event);
            dispatch(event);
          },
        },
      );
      setMessages((current) => [...current, { role: "assistant", text: streamRef.current.text, citations: streamRef.current.citations }]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (streamRef.current.text) {
          setMessages((current) => [...current, { role: "assistant", text: `${streamRef.current.text}\n\n_回答已停止_`, citations: [] }]);
        }
      } else {
        dispatch({ type: "error", error: { code: "STREAM_FAILED", message: error instanceof Error ? error.message : "回答没有完成", retryable: true } });
      }
    } finally {
      setStreaming(false);
      controller.current = null;
    }
  };

  return (
    <div className="assistant-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <aside ref={drawerRef} className="node-assistant-drawer" role="dialog" aria-modal="true" aria-labelledby="node-assistant-title">
        <div className="node-assistant-head">
          <div>
            <span className="eyebrow">本节 AI 助教</span>
            <h2 id="node-assistant-title">围绕“{nodeTitle}”提问</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭 AI 助教" onClick={close} autoFocus><X size={17} /></button>
        </div>
        <div className="node-assistant-messages" ref={messagesRef}>
          {messages.length === 0 && !isStreaming ? (
            <div className="assistant-welcome">
              <div className="chat-empty-mark"><Sparkles size={20} /></div>
              <strong>问题会自动带上当前项目和本节正文</strong>
              <span>助教只在你打开时出现，不会占用正文宽度。</span>
              <div className="assistant-prompts">
                <button type="button" onClick={() => void submit("用更直白的话解释这节最关键的概念")}>用更直白的话解释关键概念</button>
                <button type="button" onClick={() => void submit("给我一个能检验是否理解本节的例子")}>给我一个检验理解的例子</button>
                <button type="button" onClick={() => void submit("我学习这节时最容易踩什么坑？")}>这节最容易踩什么坑？</button>
              </div>
            </div>
          ) : messages.map((message, index) => (
            <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
              <div className="chat-role">{message.role === "assistant" ? <><Bot size={13} />助教</> : "你"}</div>
              {message.role === "assistant" ? <SafeMarkdown>{message.text}</SafeMarkdown> : <div className="chat-bubble">{message.text}</div>}
            </div>
          ))}
          {isStreaming && <div className="chat-message assistant"><div className="chat-role"><Bot size={13} />助教</div><SafeMarkdown>{stream.text || "正在结合本节内容思考…"}</SafeMarkdown></div>}
          {stream.phase === "failed" && <div className="chat-stream-error">{stream.error?.message ?? "回答没有完成"}</div>}
        </div>
        <div className="node-assistant-compose">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="问一个和本节有关的问题…"
            aria-label="向本节 AI 助教提问"
            disabled={isStreaming}
          />
          <button className={`button${isStreaming ? " button-danger" : ""}`} type="button" onClick={() => isStreaming ? controller.current?.abort() : void submit()} disabled={!isStreaming && !prompt.trim()}>
            {isStreaming ? <><Square size={14} />停止</> : <><Send size={14} />发送</>}
          </button>
        </div>
      </aside>
    </div>
  );
}
