import { useEffect, useRef } from "react";
import type { CourseNode, RoadmapStage } from "../../api/contracts";

export function RoadmapOutline({ stages, activeNodeId, onSelect }: { stages: RoadmapStage[]; activeNodeId?: string; onSelect: (nodeId: string) => void }) {
  const outlineRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!activeNodeId) return;
    const active = [...(outlineRef.current?.querySelectorAll<HTMLElement>(".outline-node") ?? [])].find((item) => item.dataset.nodeId === activeNodeId);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeNodeId]);
  return <nav ref={outlineRef} className="roadmap-outline" aria-label="课程目录"><div className="outline-head"><span className="eyebrow">Route map</span><strong>课程目录</strong><span>点击任意节点，定位到对应内容</span></div>{stages.map((stage) => <section className="outline-stage" key={stage.id}><div className="outline-stage-title"><span>{stage.title}</span><span>{stage.nodes.length} 节</span></div>{stage.nodes.map((node) => <OutlineButton key={node.id} node={node} active={node.id === activeNodeId} onSelect={onSelect} />)}</section>)}</nav>;
}

export function OutlineButton({ node, active, onSelect }: { node: CourseNode; active: boolean; onSelect: (nodeId: string) => void }) {
  const status = node.status === "completed" || node.status === "done" || node.status === "mastered" ? "completed" : node.status === "learning" || node.status === "active" ? "learning" : node.status === "review" || node.status === "due" ? "review" : "planned";
  return <button type="button" className={`outline-node${active ? " is-active" : ""}`} aria-current={active ? "location" : undefined} data-node-id={node.id} onClick={() => onSelect(node.id)}><span className="outline-code">{node.courseCode}</span><span className="outline-title"><i className={`outline-status ${status}`} aria-hidden="true" />{node.title}</span></button>;
}
