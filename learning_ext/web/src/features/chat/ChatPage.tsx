import { useEffect, useReducer, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, BookOpen, Pencil, Plus, Send, Square, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { streamJson } from "../../api/stream";
import { initialStreamState, streamReducer } from "../../api/streamReducer";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { SafeMarkdown } from "../../components/Markdown";
import { SectionHeader } from "../../components/SectionHeader";
import type { ConversationMessage } from "../../api/contracts";

export function ChatPage() {
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });
  const files = useQuery({ queryKey: ["library", "files"], queryFn: api.files });
  const queryClient = useQueryClient();
  const [activeConversationId, setActiveConversationId] = useState<string>();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [allSources, setAllSources] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [stream, dispatch] = useReducer(streamReducer, initialStreamState);
  const streamRef = useRef(stream);
  const [isStreaming, setStreaming] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }); }, [messages, stream.text]);
  useEffect(() => () => controller.current?.abort(), []);

  const openConversation = async (id: string) => {
    if (isStreaming) return;
    const conversation = await api.conversation(id);
    setActiveConversationId(conversation.id);
    setMessages(conversation.messages);
    setAllSources(conversation.fileIds === null);
    setSelectedFileIds(conversation.fileIds ?? []);
    dispatch({ type: "start", requestId: `history-${conversation.id}`, task: "chat-history" });
  };

  const startNewConversation = () => {
    if (isStreaming) return;
    setActiveConversationId(undefined);
    setMessages([]);
    setSelectedFileIds([]);
    setAllSources(true);
    dispatch({ type: "start", requestId: `new-${Date.now()}`, task: "chat-new" });
  };

  const renameConversation = async (id: string, currentTitle: string) => {
    if (isStreaming) return;
    const title = window.prompt("新的对话名称", currentTitle)?.trim();
    if (!title || title === currentTitle) return;
    await api.updateConversation(id, title);
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  };

  const submit = async () => {
    const text = prompt.trim();
    if (!text || isStreaming) return;
    setPrompt("");
    setMessages((current) => [...current, { role: "user", text, citations: [] }]);
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setStreaming(true);
    const startEvent = { type: "start" as const, requestId: globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}`, task: "chat" };
    streamRef.current = streamReducer(initialStreamState, startEvent);
    dispatch(startEvent);
    try {
      let conversationId = activeConversationId;
      if (!conversationId) {
        const created = await api.createConversation(text.slice(0, 32));
        conversationId = created.id;
        setActiveConversationId(created.id);
      }
      await streamJson(
        "/api/chat/stream",
        { message: text, conversation_id: conversationId, file_ids: allSources ? null : selectedFileIds },
        { signal: nextController.signal, onEvent: (event) => { streamRef.current = streamReducer(streamRef.current, event); dispatch(event); } },
      );
      setMessages((current) => [...current, { role: "assistant", text: streamRef.current.text, citations: streamRef.current.citations }]);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) dispatch({ type: "error", error: { code: "STREAM_FAILED", message: error instanceof Error ? error.message : "回答没有完成", retryable: true } });
    } finally {
      setStreaming(false);
      controller.current = null;
    }
  };

  if (conversations.isPending || files.isPending) return <div className="page-inner"><LoadingState label="正在准备知识问答" /></div>;
  if (conversations.isError || files.isError) return <div className="page-inner"><ErrorState message={(conversations.error ?? files.error)?.message ?? "知识问答暂时不可用"} onRetry={() => { void conversations.refetch(); void files.refetch(); }} /></div>;

  const historicalCitations = [...messages].reverse().find((message) => message.role === "assistant" && message.citations.length)?.citations ?? [];
  const visibleCitations = isStreaming || stream.citations.length ? stream.citations : historicalCitations;

  return <div className="page-inner"><SectionHeader eyebrow="Ask · 知识问答" title="把疑问放到桌面上" description="回答会逐段出现，引用单独列在右侧。对话和资料选择会保存在本机，下次可以继续。" action={<Link className="button button-quiet" to="/library"><BookOpen size={15} />管理资料</Link>} /><div className="chat-layout"><aside className="chat-sidebar"><div className="drawer-head"><h3>对话</h3><button className="icon-button" type="button" aria-label="新建对话" onClick={startNewConversation}><Plus size={15} /></button></div>{conversations.data.map((conversation) => <div className={`conversation-row${conversation.id === activeConversationId ? " is-active" : ""}`} key={conversation.id}><button className="conversation-item" type="button" onClick={() => void openConversation(conversation.id)}>{conversation.title}</button><button className="icon-button conversation-action" type="button" aria-label={`重命名对话 ${conversation.title}`} onClick={() => void renameConversation(conversation.id, conversation.title)}><Pencil size={13} /></button><button className="icon-button conversation-action" type="button" aria-label={`删除对话 ${conversation.title}`} onClick={() => { if (window.confirm(`确认删除“${conversation.title}”？`)) void api.deleteConversation(conversation.id).then(() => { if (activeConversationId === conversation.id) startNewConversation(); return queryClient.invalidateQueries({ queryKey: ["conversations"] }); }); }}><Trash2 size={13} /></button></div>)}{conversations.data.length === 0 && <p className="muted small" style={{ padding: 5, lineHeight: 1.6 }}>还没有历史对话。先问一个问题。</p>}</aside><section className="chat-panel"><div className="chat-messages" ref={messagesRef}>{messages.length === 0 && !isStreaming ? <div className="chat-empty"><div className="chat-empty-mark"><Sparkles size={22} /></div><h3>今天想弄懂什么？</h3><p>试试问：<span>“我应该先理解哪个概念？”</span></p></div> : messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}><div className="chat-role">{message.role === "assistant" ? <><Bot size={13} />助教</> : "你"}</div>{message.role === "assistant" ? <SafeMarkdown>{message.text}</SafeMarkdown> : <div className="chat-bubble">{message.text}</div>}</div>)}{isStreaming && <div className="chat-message assistant"><div className="chat-role"><Bot size={13} />助教</div><SafeMarkdown>{stream.text || "正在整理相关内容…"}</SafeMarkdown></div>}{stream.phase === "failed" && <div className="chat-stream-error">{stream.error?.message ?? "回答没有完成"}</div>}</div><div className="chat-compose"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder="问一个和学习有关的问题…" aria-label="输入问题" disabled={isStreaming} /><button className={`button${isStreaming ? " button-danger" : ""}`} type="button" onClick={() => { if (isStreaming) controller.current?.abort(); else void submit(); }}>{isStreaming ? <><Square size={14} />停止</> : <><Send size={14} />发送</>}</button></div></section><aside className="citation-panel"><div className="drawer-head"><h3>检索资料</h3><span className="status-badge planned">{allSources ? "全部" : selectedFileIds.length}</span></div><label className="source-choice"><input type="checkbox" checked={allSources} onChange={(event) => setAllSources(event.target.checked)} disabled={isStreaming} /><span>检索全部资料</span></label>{!allSources && <div className="source-list">{files.data.length ? files.data.map((file) => <label className="source-choice" key={file.id}><input type="checkbox" checked={selectedFileIds.includes(file.id)} onChange={(event) => setSelectedFileIds((current) => event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id))} disabled={isStreaming} /><span>{file.name}</span></label>) : <span className="muted small">资料库为空，本次将不检索来源。</span>}</div>}<div className="drawer-head citation-heading"><h3>引用来源</h3><span className="status-badge planned">{visibleCitations.length}</span></div>{visibleCitations.length === 0 ? <div className="citation-empty"><Sparkles size={16} /><span>回答出现引用后，会在这里看到原文位置。</span></div> : visibleCitations.map((citation) => <div className="citation-item" key={citation.id}><strong>{citation.title}</strong><span>{citation.excerpt ?? "没有摘要"}</span>{citation.page && <small>第 {citation.page} 页</small>}</div>)}</aside></div></div>;
}
