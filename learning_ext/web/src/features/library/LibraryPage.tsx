import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileText, FolderPlus, LoaderCircle, Pencil, Square, Trash2, UploadCloud } from "lucide-react";
import { api } from "../../api/client";
import { streamJson } from "../../api/stream";
import { initialStreamState, streamReducer } from "../../api/streamReducer";
import { EmptyState, ErrorState, LoadingState } from "../../components/AsyncState";
import { SectionHeader } from "../../components/SectionHeader";

export function LibraryPage() {
  const files = useQuery({ queryKey: ["library", "files"], queryFn: api.files });
  const groups = useQuery({ queryKey: ["library", "groups"], queryFn: api.groups });
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [progress, setProgress] = useState(initialStreamState);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [groupMessage, setGroupMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const remove = useMutation({ mutationFn: api.deleteFile, onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["library", "files"] }) });
  const createGroup = useMutation({ mutationFn: api.createGroup, onSuccess: () => { setSelectedFileIds([]); setGroupMessage("分组已创建"); void queryClient.invalidateQueries({ queryKey: ["library", "groups"] }); }, onError: (error) => setGroupMessage(error.message) });
  const updateGroup = useMutation({ mutationFn: ({ id, name, fileIds }: { id: string; name?: string; fileIds?: string[] }) => api.updateGroup(id, { name, fileIds }), onSuccess: () => { setSelectedFileIds([]); setGroupMessage("分组已更新"); void queryClient.invalidateQueries({ queryKey: ["library", "groups"] }); }, onError: (error) => setGroupMessage(error.message) });
  const deleteGroup = useMutation({ mutationFn: api.deleteGroup, onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["library", "groups"] }) });
  if (files.isPending || groups.isPending) return <div className="page-inner"><LoadingState label="正在整理资料库" /></div>;
  if (files.isError || groups.isError) return <div className="page-inner"><ErrorState message={(files.error ?? groups.error)?.message ?? "资料库暂时不可用"} onRetry={() => { void files.refetch(); void groups.refetch(); }} /></div>;
  const visible = files.data.filter((file) => file.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const startIndex = async (payload: unknown) => {
    setIndexing(true); setProgress(initialStreamState);
    const nextController = new AbortController();
    controller.current = nextController;
    try { await streamJson("/api/library/index/stream", payload, { signal: nextController.signal, onEvent: (event) => setProgress((state) => streamReducer(state, event)) }); } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setProgress((state) => ({ ...state, phase: "failed", error: { code: "INDEX_FAILED", message: error instanceof Error ? error.message : "索引没有完成", retryable: true } })); } finally { setIndexing(false); controller.current = null; void queryClient.invalidateQueries({ queryKey: ["library", "files"] }); }
  };
  const selectedFiles = files.data.filter((file) => selectedFileIds.includes(file.id));
  const makeGroup = () => {
    if (!selectedFiles.length) { setGroupMessage("请先选择要加入分组的资料"); return; }
    const indexId = selectedFiles[0].indexId;
    if (!indexId || selectedFiles.some((file) => file.indexId !== indexId)) { setGroupMessage("一个分组只能包含同一资料库中的文件"); return; }
    const name = window.prompt("分组名称");
    if (name?.trim()) createGroup.mutate({ indexId, name: name.trim(), fileIds: selectedFileIds });
  };
  const renameGroup = (id: string, currentName: string) => {
    const name = window.prompt("新的分组名称", currentName)?.trim();
    if (name && name !== currentName) updateGroup.mutate({ id, name });
  };
  return <div className="page-inner"><SectionHeader eyebrow="Library · 资料库" title="让资料为学习服务" description="上传文件并等待索引完成，知识问答就能检索并引用它们。索引进度会在这里逐阶段显示。" action={<Link className="button button-quiet" to="/chat">去知识问答</Link>} /><div className="library-layout"><section><div className="card card-pad"><div className="file-toolbar"><label className="button file-input"><UploadCloud size={15} />上传文件<input ref={fileInput} type="file" accept=".pdf,.md,.txt,.docx,.pptx" onChange={(event) => { const file = event.target.files?.[0]; if (file) { const form = new FormData(); form.append("file", file); void startIndex(form); event.currentTarget.value = ""; } }} /></label><button className="button button-secondary" type="button" onClick={makeGroup} disabled={!selectedFileIds.length || createGroup.isPending}><FolderPlus size={15} />新建分组</button><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="筛选资料…" aria-label="筛选资料" /></div>{groupMessage && <div className="inline-note">{groupMessage}</div>}{indexing && <div className="index-progress"><div><LoaderCircle className="spin" size={15} /><span>{progress.progress?.message ?? progress.progress?.stage ?? "正在建立索引"}</span></div><button className="button button-quiet" type="button" onClick={() => controller.current?.abort()}><Square size={13} />取消</button></div>}{progress.phase === "failed" && <div className="index-error">{progress.error?.message}</div>}{visible.length === 0 ? <EmptyState title={files.data.length ? "没有匹配的资料" : "资料库还是空的"} message={files.data.length ? "换一个关键词试试。" : "先上传一份课程资料，问答会更贴近你的学习内容。"} action={!files.data.length ? <button className="button button-secondary" type="button" onClick={() => fileInput.current?.click()}>选择文件</button> : undefined} /> : <div className="file-list">{visible.map((file) => <div className="file-row" key={file.id}><label className="file-select"><input type="checkbox" checked={selectedFileIds.includes(file.id)} onChange={(event) => setSelectedFileIds((current) => event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id))} /><span className="sr-only">选择 {file.name}</span></label><div><strong><FileText size={14} style={{ verticalAlign: "-3px", marginRight: 6 }} />{file.name}</strong><span>{file.kind} · {formatBytes(file.size)}</span></div><span className="file-size"><span className={`status-badge ${file.status === "ready" ? "completed" : "learning"}`}>{file.status === "ready" ? "可引用" : file.status}</span></span><a className="icon-button" href={`/api/library/files/${encodeURIComponent(file.id)}/download`} download aria-label={`下载 ${file.name}`}><Download size={15} /></a><button className="icon-button" type="button" aria-label={`删除 ${file.name}`} onClick={() => { if (window.confirm(`确认删除“${file.name}”？`)) remove.mutate(file.id); }} disabled={remove.isPending}><Trash2 size={15} /></button></div>)}</div>}</div></section><aside className="today-side"><section className="card card-pad"><div className="drawer-head"><div><div className="eyebrow">资料分组</div><h3 className="group-title">{groups.data.length} 个分组</h3></div></div>{groups.data.length === 0 ? <p className="muted small">勾选资料后创建分组，之后可以按主题维护来源。</p> : <div className="group-list">{groups.data.map((group) => <div className="group-row" key={group.id}><div><strong>{group.name}</strong><span>{group.fileIds.length} 份资料</span></div><div className="group-actions"><button className="button button-quiet" type="button" disabled={!selectedFileIds.length || updateGroup.isPending} onClick={() => updateGroup.mutate({ id: group.id, fileIds: selectedFileIds })}>更新</button><button className="icon-button" type="button" aria-label={`重命名分组 ${group.name}`} onClick={() => renameGroup(group.id, group.name)} disabled={updateGroup.isPending}><Pencil size={14} /></button><button className="icon-button" type="button" aria-label={`删除分组 ${group.name}`} onClick={() => { if (window.confirm(`确认删除分组“${group.name}”？资料本身不会删除。`)) deleteGroup.mutate(group.id); }}><Trash2 size={14} /></button></div></div>)}</div>}</section><section className="card card-pad"><div className="eyebrow">网页索引</div><h3 style={{ marginTop: 7, fontSize: 15 }}>当前版本暂不开放</h3><p className="muted small" style={{ marginTop: 8, lineHeight: 1.7 }}>网页读取器还不能可靠校验每一次跳转目标。请先把公开资料下载为受支持的文件再上传，避免访问到本机或内网地址。</p></section><section className="card card-pad"><div className="eyebrow">索引状态</div><div className="stat-list" style={{ marginTop: 15 }}><div className="stat-item"><span>资料数量</span><strong>{files.data.length}</strong></div><div className="stat-item"><span>可引用</span><strong>{files.data.filter((file) => file.status === "ready").length}</strong></div></div><div className="inline-note"><CheckCircle2 size={15} />完成 embedding 后才会显示可引用</div></section></aside></div></div>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
