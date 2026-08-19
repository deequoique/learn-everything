import { ChevronDown, Clock3, FileText, PlayCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { SafeMarkdown } from "../../components/Markdown";
import type { CourseNode } from "../../api/contracts";

export function RoadmapNode({ node, projectId, expanded, onToggle, nodeRef }: { node: CourseNode; projectId?: string; expanded: boolean; onToggle: () => void; nodeRef: (element: HTMLElement | null) => void }) {
  const status = normalizeStatus(node.status);
  return <article id={`roadmap-node-${node.id}`} ref={nodeRef} className="roadmap-node" data-node-id={node.id} data-status={status}>
    <button className="roadmap-node-heading" type="button" aria-expanded={expanded} aria-controls={`roadmap-detail-${node.id}`} onClick={onToggle}>
      <span className="node-code">{node.courseCode}</span>
      <span><h3>{node.title}</h3><p>{node.summary ?? "点击展开这一节的学习重点"}</p></span>
      <ChevronDown className={`chevron${expanded ? " is-open" : ""}`} size={18} aria-hidden="true" />
    </button>
    <div id={`roadmap-detail-${node.id}`} className="roadmap-node-detail" hidden={!expanded} role="region" aria-label={`${node.courseCode} ${node.title}`}>
      <div className="node-meta"><span className={`status-badge ${status}`}>{statusLabel(status)}</span>{node.estimatedMinutes && <span className="muted small"><Clock3 size={12} style={{ verticalAlign: "-2px" }} /> {node.estimatedMinutes} 分钟</span>}</div>
      {node.content ? <SafeMarkdown>{node.content}</SafeMarkdown> : <p className="muted small">课程内容将在准备完成后出现在这里。</p>}
      {node.practice && <div className="node-practice"><div className="eyebrow"><PlayCircle size={12} style={{ verticalAlign: "-2px" }} /> 动手练习</div><SafeMarkdown>{node.practice}</SafeMarkdown></div>}
      {node.resources.length > 0 && <div className="node-resource-list">{node.resources.map((resource) => resource.url ? <a className="node-resource" key={resource.id} href={resource.url} target="_blank" rel="noreferrer"><FileText size={14} />{resource.title}</a> : <span className="node-resource" key={resource.id}><FileText size={14} />{resource.title}</span>)}</div>}
      {projectId && <div className="form-actions"><Link className="button button-secondary" to={`/courses/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(node.id)}`}>开始这一节</Link></div>}
    </div>
  </article>;
}

function normalizeStatus(status: string) {
  if (status === "completed" || status === "done" || status === "mastered") return "completed";
  if (status === "learning" || status === "in_progress" || status === "active") return "learning";
  if (status === "review" || status === "due") return "review";
  if (status === "blocked") return "blocked";
  return "planned";
}

function statusLabel(status: string) {
  if (status === "completed") return "已完成";
  if (status === "learning") return "学习中";
  if (status === "review") return "待复习";
  if (status === "blocked") return "待解锁";
  return "计划中";
}
