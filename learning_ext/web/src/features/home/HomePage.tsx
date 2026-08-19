import { Link } from "react-router-dom";
import { ArrowRight, Check, CircleDot, Clock3, RotateCcw, Settings2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, homeKeys } from "../../api/client";
import { useProject } from "../../app/ProjectContext";
import { ErrorState, LoadingState } from "../../components/AsyncState";
import { ProgressBar } from "../../components/ProgressBar";
import { SectionHeader } from "../../components/SectionHeader";

export function HomePage() {
  const { selectedProjectId, isProjectSelectionReady } = useProject();
  const home = useQuery({
    queryKey: homeKeys.detail(selectedProjectId),
    queryFn: () => api.home(selectedProjectId),
    enabled: isProjectSelectionReady,
  });
  if (!isProjectSelectionReady || home.isPending) return <div className="page-inner"><LoadingState label="正在整理今天的学习轨迹" /></div>;
  if (home.isError) return <div className="page-inner"><ErrorState message={home.error.message} onRetry={() => void home.refetch()} /></div>;
  const data = home.data;
  const projectId = data.project?.id;
  const nextNodePath = projectId && data.nextNode ? `/courses/${projectId}/nodes/${data.nextNode.id}` : "/courses";

  return <div className="page-inner">
    <SectionHeader eyebrow="Today · 学习轨迹" title={greeting(data.status)} description={subtitle(data.status)} action={<Link className="button button-quiet" to="/help">先看使用说明 <ArrowRight size={15} /></Link>} />
    <div className="today-layout">
      <section className="hero-rail">
        <div>
          <span className="eyebrow">{data.project ? "正在前进" : "从这里开始"}</span>
          <h2>{data.project ? data.project.title : data.status === "setup" ? "把想学的事，变成一条可走的路。" : "下一条学习轨迹，等你命名。"}</h2>
          <p>{data.project ? `完成 ${data.project.completedCount} / ${data.project.nodeCount || "—"} 个节点，今天只需要走好下一步。` : "告诉我你的目标、基础和每周时间，我会把它整理成阶段清晰的学习计划。"}</p>
        </div>
        <div className="hero-rail-footer">
          <Link className="button" to={data.status === "setup" ? "/settings" : nextNodePath}>{primaryAction(data.status)} <ArrowRight size={16} /></Link>
          <span className="trajectory-line" aria-hidden="true" />
          <span className="small" style={{ color: "#aeb8d2" }}>{data.streakDays ? `连续 ${data.streakDays} 天` : "今天开始"}</span>
        </div>
      </section>
      <div className="today-side">
        {data.nextNode && <section className="card today-card today-next"><div className="next-code"><span>下一节点</span><span>{data.nextNode.courseCode}</span></div><h3>{data.nextNode.title}</h3><p>{data.nextNode.summary ?? "准备好后，从这里继续。"}</p><Link className="button" to={nextNodePath}>继续这一节 <ArrowRight size={15} /></Link></section>}
        <section className="card today-stats"><div className="today-stat"><strong>{data.dueReviewCount}</strong><span>待复习</span></div><div className="today-stat"><strong>{data.completedToday}</strong><span>今日完成</span></div></section>
        {data.project ? <section className="card today-card"><div className="eyebrow">整体进度</div><h3>{Math.round(data.project.progress * 100)}% 的路线已经留下脚印</h3><div style={{ marginTop: 15 }}><ProgressBar value={data.project.progress} /></div><Link className="inline-link" to="/dashboard">查看学习进度 <ArrowRight size={13} /></Link></section> : <section className="card today-card"><div className="eyebrow">还没有计划</div><h3>先写下你想抵达的地方</h3><p>创建路线后，课程、复习和进度会在这里汇合。</p><Link className="inline-link" to="/courses/plan">创建学习计划 <ArrowRight size={13} /></Link></section>}
      </div>
    </div>
    <div className="today-lower grid-3" style={{ marginTop: 17 }}>
      <Link className="card card-pad quick-link" to="/review"><CircleDot size={18} color="var(--amber)" /><strong>处理今日复习</strong><span>{data.dueReviewCount ? `${data.dueReviewCount} 张卡片等你判断` : "今天没有到期卡片"}</span></Link>
      <Link className="card card-pad quick-link" to="/courses/plan"><Clock3 size={18} color="var(--indigo)" /><strong>打开学习计划</strong><span>按阶段查看整条路线</span></Link>
      <Link className="card card-pad quick-link" to="/settings"><Settings2 size={18} color="var(--mint)" /><strong>检查 AI 连接</strong><span>{data.configured ? "连接已配置" : "还没有连接模型"}</span></Link>
    </div>
    {data.status === "complete" && <div className="completion-note"><Check size={18} /><span>这条路线已经走完。可以回顾薄弱节点，或者开启下一条学习轨迹。</span><Link to="/courses/plan">创建新计划</Link><RotateCcw size={15} /></div>}
  </div>;
}

function greeting(status: string) {
  if (status === "setup") return "先连接你的学习引擎。";
  if (status === "empty") return "今天，给目标一个起点。";
  if (status === "complete") return "你已经走完一条路。";
  return "今天只走下一步。";
}

function subtitle(status: string) {
  if (status === "setup") return "连接模型后，你就可以把一个模糊目标整理成可执行的学习路线。";
  if (status === "empty") return "不需要先读说明书；从一个目标开始，系统会把后续步骤摆到你面前。";
  if (status === "complete") return "把已经掌握的内容沉淀下来，再决定下一段要探索什么。";
  return "你的学习空间会记住当前位置、待复习内容和下一节课。";
}

function primaryAction(status: string) {
  if (status === "setup") return "连接 AI";
  if (status === "empty") return "创建路线";
  if (status === "complete") return "开始新路线";
  return "继续学习";
}
