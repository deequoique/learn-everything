import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Bot, Download, ExternalLink, FolderKanban, LoaderCircle, PanelLeft, Plus, Sparkles, Square, Trash2, Upload, X } from "lucide-react";
import { api, dashboardKeys, homeKeys, projectKeys } from "../../api/client";
import type { Project, Roadmap, StreamEvent } from "../../api/contracts";
import { EmptyState, ErrorState, LoadingState } from "../../components/AsyncState";
import { SafeMarkdown } from "../../components/Markdown";
import { ProgressBar } from "../../components/ProgressBar";
import { SectionHeader } from "../../components/SectionHeader";
import { useProject } from "../../app/ProjectContext";
import { streamJson } from "../../api/stream";
import { initialStreamState, streamReducer } from "../../api/streamReducer";
import { RoadmapExplorer } from "./RoadmapExplorer";
import { NodeAssistantDrawer } from "./NodeAssistantDrawer";
import { projectMarker, projectMeta, projectOptionLabel } from "./projectPresentation";

export function CoursesPage() {
  const projects = useQuery({ queryKey: projectKeys.list(), queryFn: api.projects });
  const { selectedProject, selectProject } = useProject();
  const selected = selectedProject;
  if (projects.isPending) return <div className="page-inner"><LoadingState label="正在整理你的课程" /></div>;
  if (projects.isError && !projects.data) return <div className="page-inner"><ErrorState message={projects.error.message} onRetry={() => void projects.refetch()} /></div>;
  return <div className="page-inner"><SectionHeader eyebrow="Courses · 课程" title="从当前位置继续" description="课程把路线、正文和练习放在一处。你不需要记住任何项目编号。" action={<Link className="button" to="/courses/plan"><BookOpen size={15} />打开学习计划</Link>} /><div className="course-tabs"><Link className="course-tab is-active" to="/courses">继续学习</Link><Link className="course-tab" to="/courses/plan">学习计划</Link><Link className="course-tab" to="/courses/projects">项目管理</Link></div>{selected ? <div className="course-grid"><section className="card card-pad"><div className="eyebrow">当前学习计划</div><h2 style={{ marginTop: 8, fontSize: 24, letterSpacing: "-.04em" }}>{selected.title}</h2><p className="project-meta">{projectMeta(selected)}</p><p className="muted small" style={{ marginTop: 8, lineHeight: 1.7 }}>{selected.description ?? "一条按你的目标安排的学习路线。"}</p><div style={{ marginTop: 22 }}><ProgressBar value={selected.progress} label={`${selected.completedCount} / ${selected.nodeCount || "—"} 个节点`} /></div><div className="form-actions" style={{ marginTop: 22 }}><Link className="button" to="/courses/plan">进入路线 <ArrowRight size={15} /></Link><Link className="button button-quiet" to="/dashboard">查看进度</Link></div></section><aside className="course-list"><div className="eyebrow" style={{ margin: "4px 2px" }}>我的计划</div>{projects.data.map((project) => <button key={project.id} className="course-list-item" type="button" onClick={() => selectProject(project.id)}><span><strong>{project.title}</strong><span>{projectMarker(project.id)} · {Math.round(project.progress * 100)}% 完成 · {project.nodeCount || "—"} 个节点</span></span><ArrowRight size={16} color={project.id === selected.id ? "var(--indigo)" : "var(--ink-muted)"} /></button>)}</aside></div> : <section className="card"><EmptyState title="还没有学习计划" message="把一个目标变成阶段清晰的路线，下一节课会自动出现在今日。" action={<Link className="button" to="/courses/plan">创建学习计划 <ArrowRight size={15} /></Link>} /></section>}</div>;
}

export function RoadmapPage() {
  const projects = useQuery({ queryKey: projectKeys.list(), queryFn: api.projects });
  const { selectedProject, selectProject } = useProject();
  const queryClient = useQueryClient();
  const selected = selectedProject;
  const roadmap = useQuery({ queryKey: selected ? projectKeys.roadmap(selected.id) : ["roadmap", "none"], queryFn: () => api.roadmap(selected!.id), enabled: Boolean(selected) });
  const [prepareState, setPrepareState] = useState(initialStreamState);
  const [preparing, setPreparing] = useState(false);
  const [creationOpen, setCreationOpen] = useState(false);
  const prepareController = useRef<AbortController | null>(null);
  const creationTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => () => prepareController.current?.abort(), []);
  const closeCreation = useCallback(() => {
    setCreationOpen(false);
    window.setTimeout(() => creationTriggerRef.current?.focus(), 0);
  }, []);
  const finishCreation = async (projectId: string, signal?: AbortSignal) => {
    const refreshed = await projects.refetch();
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!refreshed.data?.some((project) => project.id === projectId)) {
      throw new Error("路线已经生成，但项目列表暂时没有刷新。请点击下方按钮重新载入。");
    }
    selectProject(projectId);
    closeCreation();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: projectKeys.all }),
      queryClient.invalidateQueries({ queryKey: homeKeys.all }),
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
    ]);
  };
  const prepare = async () => {
    if (!selected || preparing) return;
    const controller = new AbortController();
    prepareController.current = controller;
    setPreparing(true);
    setPrepareState(initialStreamState);
    try {
      await streamJson(`/api/projects/${encodeURIComponent(selected.id)}/prepare/stream`, {}, { signal: controller.signal, onEvent: (event) => setPrepareState((state) => streamReducer(state, event)) });
      await roadmap.refetch();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setPrepareState((state) => ({ ...state, phase: "failed", error: { code: "PREPARE_FAILED", message: error instanceof Error ? error.message : "课程准备没有完成", retryable: true } }));
    } finally {
      setPreparing(false);
      prepareController.current = null;
    }
  };
  if (projects.isPending) return <div className="page-inner"><LoadingState label="正在展开学习路线" /></div>;
  if (projects.isError && !projects.data) return <div className="page-inner"><ErrorState message={projects.error.message} onRetry={() => void projects.refetch()} /></div>;
  if (!selected) return <div className="page-inner"><SectionHeader eyebrow="Courses · 学习计划" title="先创建一条路线" description="从一个具体目标出发，系统会帮你安排阶段、节点和下一步。" /><RouteGenerator onCreated={finishCreation} /></div>;
  const creationAction = <div className="section-header-action"><button ref={creationTriggerRef} className="button" type="button" onClick={() => setCreationOpen(true)} aria-haspopup="dialog" aria-expanded={creationOpen}><Plus size={15} />新建学习计划</button><select className="project-select" value={selected.id} onChange={(event) => selectProject(event.target.value)} aria-label="选择学习计划">{(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{projectOptionLabel(project)}</option>)}</select><button className="button button-secondary" type="button" onClick={() => preparing ? prepareController.current?.abort() : void prepare()}>{preparing ? <><Square size={14} />取消准备</> : <><Sparkles size={14} />准备课程内容</>}</button><Link className="button button-quiet" to="/courses/projects"><FolderKanban size={15} />管理计划</Link></div>;
  const creationDialog = creationOpen ? <RouteCreationDialog onClose={closeCreation} onCreated={finishCreation} /> : null;
  if (roadmap.isPending) return <div className="page-inner"><SectionHeader eyebrow="Courses · 学习计划" title={selected.title} action={creationAction} /><LoadingState label="正在展开学习路线" />{creationDialog}</div>;
  if (roadmap.isError) return <div className="page-inner"><SectionHeader eyebrow="Courses · 学习计划" title={selected.title} action={creationAction} /><ErrorState message={roadmap.error.message} onRetry={() => void roadmap.refetch()} />{creationDialog}</div>;
  const data = roadmap.data as Roadmap;
  return <div className="page-inner"><SectionHeader eyebrow="Courses · 学习计划" title={selected.title} description="课程目录固定在左侧，正文在自己的滚动区域里。点击任意节点，直接跳到你想去的地方。" action={creationAction} />{(prepareState.phase === "running" || prepareState.phase === "failed") && <div className={prepareState.phase === "failed" ? "index-error" : "index-progress"}><span>{prepareState.error?.message ?? prepareState.progress?.message ?? "正在准备课程"}</span>{prepareState.progress?.total ? <span>{prepareState.progress.completed} / {prepareState.progress.total}</span> : null}</div>}<RoadmapExplorer roadmap={data} projectId={selected.id} />{creationDialog}</div>;
}

export function ProjectManagerPage() {
  const projects = useQuery({ queryKey: projectKeys.list(), queryFn: api.projects });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { selectedProjectId, selectProject } = useProject();
  const importInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [operation, setOperation] = useState<{ projectId?: string; text?: string; tone?: "error" | "success" }>({});
  const remove = useMutation({ mutationFn: api.deleteProject });
  const imported = useMutation({ mutationFn: api.importProject, onSuccess: () => { setOperation({ text: "路线已导入", tone: "success" }); void queryClient.invalidateQueries({ queryKey: projectKeys.all }); }, onError: (error) => setOperation({ text: error.message, tone: "error" }) });
  useEffect(() => () => controller.current?.abort(), []);
  const deleteProject = async (project: Project) => {
    if (!window.confirm(`确认删除“${project.title}”（${projectMeta(project)}）及其学习记录？此操作不可撤销。`)) return;
    setOperation({ projectId: project.id, text: "正在删除…" });
    try {
      await remove.mutateAsync(project.id);
      const current = queryClient.getQueryData<Project[]>(projectKeys.list()) ?? projects.data ?? [];
      const deletedIndex = current.findIndex((item) => item.id === project.id);
      const remaining = current.filter((item) => item.id !== project.id);
      queryClient.setQueryData(projectKeys.list(), remaining);
      if (selectedProjectId === project.id) {
        const nextProject = remaining[deletedIndex] ?? remaining[Math.max(0, deletedIndex - 1)] ?? remaining[0];
        selectProject(nextProject?.id);
      }
      setOperation({ tone: "success", text: `已删除学习计划“${project.title}”（${projectMeta(project)}）` });
      void Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: homeKeys.all }),
        queryClient.invalidateQueries({ queryKey: projectKeys.all }),
        queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
      ]);
    } catch (error) {
      setOperation({ projectId: project.id, tone: "error", text: error instanceof Error ? `删除失败：${error.message}` : "删除失败，请稍后重试" });
    }
  };
  const runOperation = async (projectId: string, url: string, body: unknown) => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setOperation({ projectId, text: "正在处理…" });
    let result: unknown;
    try {
      await streamJson(url, body, { signal: next.signal, onEvent: (event) => { if (event.type === "progress") setOperation({ projectId, text: event.message ?? event.stage }); if (event.type === "result") result = event.result; } });
      const source = result && typeof result === "object" ? result as Record<string, unknown> : {};
      const audit = source.audit && typeof source.audit === "object" ? source.audit as Record<string, unknown> : undefined;
      setOperation({ projectId, tone: "success", text: audit ? `审计完成：${String(audit.verdict ?? "请查看结果")}${audit.score === undefined ? "" : ` · ${String(audit.score)} 分`}` : "操作已完成" });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setOperation({ projectId, tone: "error", text: error instanceof Error ? error.message : "操作没有完成" });
    } finally {
      controller.current = null;
    }
  };
  if (projects.isPending) return <div className="page-inner"><LoadingState label="正在载入项目" /></div>;
  if (projects.isError && !projects.data) return <div className="page-inner"><ErrorState message={projects.error.message} onRetry={() => void projects.refetch()} /></div>;
  return (
    <div className="page-inner">
      <SectionHeader
        eyebrow="Courses · 项目管理"
        title="管理你的学习计划"
        description="调整、审计、导入导出和删除集中在这里；会重置学习进度的操作会先确认。"
        action={<div className="form-actions"><label className="button button-secondary file-input"><Upload size={14} />导入路线<input ref={importInput} type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((payload) => imported.mutate(payload)); event.currentTarget.value = ""; }} /></label><Link className="button" to="/courses/plan"><BookOpen size={15} />回到路线</Link></div>}
      />
      {operation.text && !operation.projectId && <div role={operation.tone === "error" ? "alert" : "status"} className={operation.tone === "error" ? "index-error" : "inline-note"}>{operation.text}</div>}
      <div className="course-list">
        {projects.data.length === 0 ? (
          <section className="card"><EmptyState title="还没有项目" message="先连接模型，再把学习目标变成计划。" action={<Link className="button" to="/settings">连接 AI</Link>} /></section>
        ) : projects.data.map((project) => {
          const isDeleting = remove.isPending && remove.variables === project.id;
          return (
            <section key={project.id} className="card card-pad project-row">
              <div className="project-row-main">
                <div className="project-symbol"><FolderKanban size={18} /></div>
                <div>
                  <h3>{project.title}</h3>
                  <div className="project-meta">{projectMeta(project)}</div>
                  <p>{project.description ?? "暂无描述"}</p>
                  <ProgressBar value={project.progress} label={`${project.completedCount} / ${project.nodeCount || "—"} 个节点`} />
                  {operation.projectId === project.id && operation.text && <div role={operation.tone === "error" ? "alert" : "status"} className={operation.tone === "error" ? "index-error" : "inline-note"}>{operation.text}</div>}
                </div>
              </div>
              <div className="project-row-actions">
                <button className="button button-secondary" type="button" aria-label={`打开学习计划 ${project.title} ${projectMarker(project.id)}`} onClick={() => { selectProject(project.id); navigate("/courses/plan"); }}>打开</button>
                <button className="button button-quiet" type="button" onClick={() => { const instruction = window.prompt("希望怎样调整这条路线？\n调整会重建节点并清空该路线现有学习进度。"); if (instruction?.trim() && window.confirm("确认调整路线并清空这条路线的现有学习进度吗？")) void runOperation(project.id, `/api/projects/${encodeURIComponent(project.id)}/refine/stream`, { instruction: instruction.trim() }); }}>调整</button>
                <button className="button button-quiet" type="button" onClick={() => void runOperation(project.id, `/api/projects/${encodeURIComponent(project.id)}/audit/stream`, { apply: false })}>审计</button>
                <a className="button button-quiet" href={`/api/projects/${encodeURIComponent(project.id)}/export`} download><Download size={14} />导出</a>
                <button className="icon-button" type="button" aria-label={isDeleting ? `正在删除学习计划 ${project.title} ${projectMarker(project.id)}` : `删除学习计划 ${project.title} ${projectMarker(project.id)}`} onClick={() => void deleteProject(project)} disabled={remove.isPending}>{isDeleting ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}</button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function WorkbenchPage() {
  const { projectId, nodeId } = useParams();
  const node = useQuery({ queryKey: ["node", nodeId], queryFn: () => api.node(nodeId!), enabled: Boolean(nodeId) });
  const savedNote = useQuery({ queryKey: ["node", nodeId, "note"], queryFn: () => api.note(nodeId!), enabled: Boolean(nodeId) });
  const [directoryOpen, setDirectoryOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [note, setNote] = useState("");
  const [generation, setGeneration] = useState(initialStreamState);
  const generationController = useRef<AbortController | null>(null);
  const assistantTriggerRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const statusMutation = useMutation({ mutationFn: (status: string) => api.updateNodeStatus(nodeId!, status), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["node", nodeId] }) });

  useEffect(() => { if (savedNote.data) setNote(savedNote.data.note); }, [savedNote.data]);
  useEffect(() => () => generationController.current?.abort(), []);

  const generate = async (kind: "content" | "practice" | "resources") => {
    if (!nodeId) return;
    const controller = new AbortController();
    generationController.current = controller;
    setGeneration(initialStreamState);
    try {
      await streamJson(`/api/nodes/${encodeURIComponent(nodeId)}/${kind}/stream`, {}, { signal: controller.signal, onEvent: (event) => setGeneration((state) => streamReducer(state, event)) });
      await node.refetch();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setGeneration((state) => ({ ...state, phase: "failed", error: { code: "GENERATE_FAILED", message: error instanceof Error ? error.message : "内容生成没有完成", retryable: true } }));
    } finally {
      generationController.current = null;
    }
  };
  const closeAssistant = () => {
    setAssistantOpen(false);
    window.setTimeout(() => assistantTriggerRef.current?.focus(), 0);
  };

  if (node.isPending) return <div className="page-inner"><LoadingState label="正在打开这一节" /></div>;
  if (node.isError || !node.data) return <div className="page-inner"><ErrorState message={node.error?.message ?? "找不到这一节"} /></div>;
  const current = node.data;
  const isMastered = current.status === "mastered" || current.status === "completed";

  return (
    <div className="page-inner">
      <div className="workbench-top">
        <div><span className="eyebrow">{current.courseCode} · {current.stageTitle}</span><h1>{current.title}</h1></div>
        <div className="form-actions">
          <Link className="button button-quiet" to="/courses/plan"><PanelLeft size={15} />回到目录</Link>
          <button className="button button-secondary" type="button" onClick={() => void generate("content")} disabled={generation.phase === "running"}><Sparkles size={15} />生成教学内容</button>
          <button className="button button-secondary" type="button" onClick={() => void generate("practice")} disabled={generation.phase === "running"}>生成实操</button>
          <button ref={assistantTriggerRef} className="button" type="button" onClick={() => setAssistantOpen(true)} aria-haspopup="dialog" aria-expanded={assistantOpen}><Bot size={15} />问本节助教</button>
        </div>
      </div>
      {(generation.phase === "running" || generation.phase === "failed") && <div className={generation.phase === "failed" ? "index-error" : "index-progress"}>{generation.error?.message ?? generation.progress?.message ?? "正在生成"}</div>}
      <div className={`workbench${directoryOpen ? " directory-visible" : ""}`}>
        <aside className="workbench-directory card">
          <div className="drawer-head"><strong>本节状态</strong><button className="icon-button" type="button" onClick={() => setDirectoryOpen(false)} aria-label="收起课程目录"><PanelLeft size={15} /></button></div>
          <button className="button button-secondary" type="button" style={{ width: "100%", marginTop: 20 }} onClick={() => statusMutation.mutate("mastered")} disabled={statusMutation.isPending || isMastered}>{statusMutation.isPending ? "正在保存" : isMastered ? "已完成这一节" : "完成这一节"}</button>
        </aside>
        <article className="workbench-content card">
          <div className="workbench-content-head"><span className={`status-badge ${isMastered ? "completed" : "learning"}`}>{isMastered ? "已完成" : "学习中"}</span><span className="muted small">把注意力留给一个问题</span></div>
          <SafeMarkdown>{current.content ?? current.description ?? "本节内容还在准备中。"}</SafeMarkdown>
          {current.practice && <div className="workbench-practice"><div className="eyebrow">动手练习</div><SafeMarkdown>{current.practice}</SafeMarkdown></div>}
          <section className="workbench-resources" aria-labelledby="workbench-resources-title">
            <div className="drawer-head">
              <div><div className="eyebrow">与正文配套</div><strong id="workbench-resources-title">参考资料</strong></div>
              <button className="button button-quiet" type="button" onClick={() => void generate("resources")} disabled={generation.phase === "running"}>{current.resources.length ? "重新整理" : "生成参考资料"}</button>
            </div>
            {current.resources.length ? <div className="workbench-resource-list">{current.resources.map((resource) => {
              const content = <><span><strong>{resource.title}</strong>{resource.description && <small>{resource.description}</small>}</span>{resource.url && <ExternalLink size={14} />}</>;
              return resource.url ? <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer" className="workbench-resource-item">{content}</a> : <div key={resource.id} className="workbench-resource-item">{content}</div>;
            })}</div> : <p className="muted small">还没有参考资料。生成后会列出与本节正文直接相关的来源。</p>}
          </section>
          <div className="workbench-note">
            <div className="drawer-head"><strong>我的笔记</strong><button className="button button-quiet" type="button" onClick={() => void api.saveNote(current.id, note)}>保存笔记</button></div>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="写下一个还没想通的问题，之后可以从这里继续。" />
          </div>
        </article>
      </div>
      {!directoryOpen && <button className="button button-secondary workbench-reopen" type="button" onClick={() => setDirectoryOpen(true)}><PanelLeft size={15} />显示状态栏</button>}
      {assistantOpen && nodeId && projectId && <NodeAssistantDrawer nodeId={nodeId} projectId={projectId} nodeTitle={current.title} onClose={closeAssistant} />}
    </div>
  );
}

function RouteCreationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (projectId: string, signal?: AbortSignal) => Promise<void> }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!dialogRef.current?.contains(activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="route-creation-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={dialogRef} className="route-creation-drawer" role="dialog" aria-modal="true" aria-labelledby="route-creation-title" aria-describedby="route-creation-description">
        <div className="route-creation-head">
          <div>
            <span className="eyebrow">New trajectory · 新路线</span>
            <h2 id="route-creation-title">新建学习计划</h2>
            <p id="route-creation-description">当前路线会保留到新计划成功生成并保存。</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭新建学习计划" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="route-creation-body"><RouteGenerator onCreated={onCreated} autoFocusTopic /></div>
      </aside>
    </div>
  );
}

function RouteGenerator({ onCreated, autoFocusTopic = false }: { onCreated: (projectId: string, signal?: AbortSignal) => Promise<void>; autoFocusTopic?: boolean }) {
  const [topic, setTopic] = useState("");
  const [background, setBackground] = useState("");
  const [goal, setGoal] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("4");
  const [state, setState] = useState(initialStreamState);
  const resultRef = useRef<unknown>(undefined);
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [pendingProjectId, setPendingProjectId] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const submit = async () => {
    if (!topic.trim() || generating || controller.current) return;
    setGenerating(true);
    setState(initialStreamState);
    if (pendingProjectId) {
      const finalizeController = new AbortController();
      controller.current = finalizeController;
      setFinalizing(true);
      try {
        await onCreated(pendingProjectId, finalizeController.signal);
        setPendingProjectId(undefined);
      } catch (error) {
        setState((current) => ({ ...current, phase: "failed", error: { code: "PROJECT_REFRESH_FAILED", message: error instanceof Error ? error.message : "新路线已生成，但暂时无法打开", retryable: true } }));
      } finally {
        setFinalizing(false);
        setGenerating(false);
        if (controller.current === finalizeController) controller.current = null;
      }
      return;
    }
    resultRef.current = undefined;
    const nextController = new AbortController();
    controller.current = nextController;
    try {
      await streamJson("/api/projects/generate/stream", { topic: topic.trim(), background: background.trim(), goal: goal.trim(), weekly_hours: Number(weeklyHours) || 4, save: true }, { signal: nextController.signal, onEvent: (event: StreamEvent) => { if (event.type === "result") resultRef.current = event.result; setState((current) => streamReducer(current, event)); } });
      const projectId = extractProjectId(resultRef.current);
      if (!projectId) throw new Error("路线已生成，但响应中缺少新计划标识。请重试。");
      setPendingProjectId(projectId);
      setFinalizing(true);
      await onCreated(projectId, nextController.signal);
      setPendingProjectId(undefined);
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      setState((current) => ({ ...current, phase: "failed", error: { code: cancelled ? "GENERATE_CANCELLED" : "GENERATE_FAILED", message: cancelled ? "已取消生成，当前学习计划没有改变。你可以调整内容后重试。" : error instanceof Error ? error.message : "路线生成没有完成", retryable: true } }));
    } finally {
      setFinalizing(false);
      setGenerating(false);
      if (controller.current === nextController) controller.current = null;
    }
  };
  const primaryLabel = finalizing ? "正在打开新路线…" : controller.current ? <><Square size={14} />取消生成</> : pendingProjectId ? "重新载入已生成路线" : state.phase === "failed" ? "重试生成" : "生成并保存路线";
  return <section className="card card-pad route-generator"><div className="generator-intro"><div className="empty-orbit" aria-hidden="true" /><div><h3>把目标说清楚，路线才会贴近你</h3><p>这几个问题足够开始。生成过程中只展示阶段进度，完整路线校验通过后才会出现。</p></div></div><form aria-busy={generating} onSubmit={(event) => { event.preventDefault(); void submit(); }}><div className="generator-fields"><div className="form-field generator-topic"><label htmlFor="route-topic">我想学什么？</label><input id="route-topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如：从零开始做一个数据分析项目" autoFocus={autoFocusTopic} disabled={generating} /></div><div className="form-field"><label htmlFor="route-goal">希望抵达哪里？</label><input id="route-goal" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="例如：能独立完成一份分析报告" disabled={generating} /></div><div className="form-field"><label htmlFor="route-background">我现在的基础</label><textarea id="route-background" value={background} onChange={(event) => setBackground(event.target.value)} placeholder="简单说说你已经会什么" disabled={generating} /></div><div className="form-field"><label htmlFor="route-hours">每周可投入时间</label><input id="route-hours" type="number" min="1" max="40" value={weeklyHours} onChange={(event) => setWeeklyHours(event.target.value)} disabled={generating} /></div></div>{state.phase === "running" && <div className="generator-progress"><div><span>{state.progress?.stage ?? "准备中"}</span><small>{state.progress?.message ?? "正在安排学习顺序"}</small></div><strong>{state.progress?.total ? `${state.progress.completed} / ${state.progress.total}` : "…"}</strong></div>}{state.phase === "failed" && <div className="index-error" role="alert">{state.error?.message}</div>}<div className="form-actions" style={{ marginTop: 18 }}><button className="button" type="button" onClick={() => controller.current ? controller.current.abort() : void submit()} disabled={!topic.trim() || finalizing}>{primaryLabel}</button><span className="muted small">预计需要一点时间，期间可以取消页面请求。</span></div></form></section>;
}

function extractProjectId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  if (source.payload && typeof source.payload === "object") return extractProjectId(source.payload);
  const project = source.project;
  if (typeof source.project_id === "string" || typeof source.project_id === "number") return String(source.project_id);
  if (typeof source.projectId === "string" || typeof source.projectId === "number") return String(source.projectId);
  if (project && typeof project === "object") {
    const id = (project as Record<string, unknown>).id;
    if (typeof id === "string" || typeof id === "number") return String(id);
  }
  return typeof source.id === "string" || typeof source.id === "number" ? String(source.id) : undefined;
}
