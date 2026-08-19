import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import type { Roadmap, RoadmapStage } from "../../api/contracts";
import { RoadmapNode } from "./RoadmapNode";
import { RoadmapOutline } from "./RoadmapOutline";

export function RoadmapExplorer({ roadmap, initialNodeId, projectId }: { roadmap: Roadmap; initialNodeId?: string; projectId?: string }) {
  const firstNode = roadmap.nodes[0];
  const initial = initialNodeId ?? roadmap.nodes.find((node) => node.status === "learning" || node.status === "active")?.id ?? firstNode?.id;
  const [activeNodeId, setActiveNodeId] = useState(initial);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initial ? [initial] : []));
  const [outlineOpen, setOutlineOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const manualSelectionUntil = useRef(0);
  const stages = useMemo(() => roadmap.stages.length ? roadmap.stages : groupNodes(roadmap.nodes), [roadmap.nodes, roadmap.stages]);

  useEffect(() => {
    setActiveNodeId(initial);
    setExpanded(new Set(initial ? [initial] : []));
  }, [initial]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (performance.now() < manualSelectionUntil.current) return;
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => Math.abs(a.boundingClientRect.top - root.getBoundingClientRect().top) - Math.abs(b.boundingClientRect.top - root.getBoundingClientRect().top));
      const candidate = visible[0]?.target.getAttribute("data-node-id");
      if (candidate) setActiveNodeId(candidate);
    }, { root, rootMargin: "-10% 0px -72% 0px", threshold: [0, .2, .8] });
    for (const element of nodeRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [roadmap.nodes]);

  const selectNode = useCallback((nodeId: string) => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    manualSelectionUntil.current = performance.now() + (reduceMotion ? 100 : 1000);
    setActiveNodeId(nodeId);
    setExpanded((current) => {
      const next = new Set(current);
      next.add(nodeId);
      return next;
    });
    setOutlineOpen(false);
    const scroll = () => {
      const target = nodeRefs.current.get(nodeId);
      if (!target) return;
      target.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(scroll); else window.setTimeout(scroll, 0);
  }, []);

  return <div className="roadmap-shell"><button className="button button-secondary roadmap-menu-button" type="button" onClick={() => setOutlineOpen(true)}><Menu size={15} />课程目录</button><div className="roadmap-workspace"><RoadmapOutline stages={stages} activeNodeId={activeNodeId} onSelect={selectNode} /><div ref={contentRef} className="roadmap-content" tabIndex={0} aria-label="路线正文">{roadmap.nodes.map((node) => <RoadmapNode key={node.id} node={node} projectId={projectId} expanded={expanded.has(node.id)} onToggle={() => setExpanded((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })} nodeRef={(element) => { if (element) nodeRefs.current.set(node.id, element); else nodeRefs.current.delete(node.id); }} />)}</div></div>{outlineOpen && <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOutlineOpen(false); }}><aside className="drawer" aria-label="课程目录抽屉"><div className="drawer-head"><strong>课程目录</strong><button className="icon-button" type="button" onClick={() => setOutlineOpen(false)} aria-label="关闭课程目录"><X size={17} /></button></div><div className="outline-stage">{stages.map((stage) => <section key={stage.id}><div className="outline-stage-title"><span>{stage.title}</span><span>{stage.nodes.length} 节</span></div>{stage.nodes.map((node) => <button type="button" key={node.id} className={`outline-node${node.id === activeNodeId ? " is-active" : ""}`} onClick={() => selectNode(node.id)}><span className="outline-code">{node.courseCode}</span><span className="outline-title">{node.title}</span></button>)}</section>)}</div></aside></div>}</div>;
}

function groupNodes(nodes: Roadmap["nodes"]): RoadmapStage[] {
  const groups = new Map<string, RoadmapStage>();
  for (const node of nodes) {
    const current = groups.get(node.stageId) ?? { id: node.stageId, title: node.stageTitle, nodes: [] };
    current.nodes.push(node);
    groups.set(node.stageId, current);
  }
  return [...groups.values()];
}
