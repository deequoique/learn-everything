import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Flame, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { api, dashboardKeys, projectKeys } from "../../api/client";
import { useProject } from "../../app/ProjectContext";
import { EmptyState, ErrorState, LoadingState } from "../../components/AsyncState";
import { ProgressBar } from "../../components/ProgressBar";
import { SectionHeader } from "../../components/SectionHeader";
import { projectOptionLabel } from "../courses/projectPresentation";

export function DashboardPage() {
  const projects = useQuery({ queryKey: projectKeys.list(), queryFn: api.projects });
  const { selectedProject, selectProject } = useProject();
  const selected = selectedProject;
  const dashboard = useQuery({
    queryKey: dashboardKeys.detail(selected?.id),
    queryFn: () => api.dashboard(selected?.id),
    enabled: Boolean(selected),
  });

  if (projects.isPending || (selected && dashboard.isPending)) return <div className="page-inner"><LoadingState label="正在绘制学习进度" /></div>;
  if (projects.isError || dashboard.isError) return <div className="page-inner"><ErrorState message={(projects.error ?? dashboard.error)?.message ?? "进度暂时不可用"} onRetry={() => { void projects.refetch(); void dashboard.refetch(); }} /></div>;
  if (!selected || !dashboard.data) {
    return <div className="page-inner"><SectionHeader eyebrow="Progress · 学习进度" title="进度会从第一步开始" description="完成一个节点后，这里会记录你的节奏、分布和回顾。" /><section className="card"><EmptyState title="还没有可以统计的路线" message="创建计划后，你会在这里看到一条属于自己的学习轨迹。" action={<Link className="button" to="/courses/plan">创建学习计划 <ArrowRight size={15} /></Link>} /></section></div>;
  }

  const trend = dashboard.data.trend;
  const maxMinutes = Math.max(1, ...trend.map((item) => item.minutes));
  const statusCounts = Object.entries(dashboard.data.statusCounts);
  return (
    <div className="page-inner">
      <SectionHeader
        eyebrow="Progress · 学习进度"
        title="看见自己走了多远"
        description="数据只为帮助你选择下一步，不把学习变成一张需要追赶的报表。"
        action={<select className="project-select" value={selected.id} onChange={(event) => selectProject(event.target.value)} aria-label="选择学习计划">{projects.data?.map((project) => <option key={project.id} value={project.id}>{projectOptionLabel(project)}</option>)}</select>}
      />
      <div className="grid-3 dashboard-stats">
        <section className="card card-pad"><div className="stat-heading"><Target size={16} color="var(--indigo)" /><span>路线完成度</span></div><strong className="big-number">{Math.round(selected.progress * 100)}<small>%</small></strong><ProgressBar value={selected.progress} /></section>
        <section className="card card-pad"><div className="stat-heading"><Flame size={16} color="var(--amber)" /><span>节点完成</span></div><strong className="big-number">{selected.completedCount}<small> / {selected.nodeCount || "—"}</small></strong><span className="muted small">继续保持稳定节奏</span></section>
        <section className="card card-pad"><div className="stat-heading"><CalendarDays size={16} color="var(--mint)" /><span>本周状态</span></div><strong className="big-number">{trend.reduce((sum, item) => sum + item.completed, 0)}<small> 节</small></strong><span className="muted small">最近 {trend.length || 0} 天的完成记录</span></section>
      </div>
      <div className="grid-2" style={{ marginTop: 17 }}>
        <section className="card card-pad">
          <div className="panel-title"><div><div className="eyebrow">学习节奏</div><h3>最近 14 天</h3></div><span className="muted small">分钟</span></div>
          {trend.length ? <div className="chart" aria-label="最近学习分钟数柱状图">{trend.map((item) => <div className="chart-bar" key={item.date} title={`${item.date} · ${item.minutes} 分钟`}><i style={{ height: `${Math.max(4, item.minutes / maxMinutes * 100)}%` }} /><span>{item.date.slice(5)}</span></div>)}</div> : <EmptyState title="还没有趋势记录" message="完成第一节课后，这里会出现你的真实节奏。" />}
        </section>
        <section className="card card-pad">
          <div className="panel-title"><div><div className="eyebrow">节点分布</div><h3>路线的不同阶段</h3></div></div>
          {statusCounts.length ? <div className="status-bars" style={{ marginTop: 24 }}>{statusCounts.map(([name, count]) => { const total = Math.max(1, selected.nodeCount); return <div className="status-bar" key={name}><span>{statusLabel(name)}</span><div><i style={{ width: `${Math.min(100, count / total * 100)}%` }} /></div><strong>{count}</strong></div>; })}</div> : <EmptyState title="还没有状态分布" message="路线节点开始变化后，这里会跟着更新。" />}
        </section>
      </div>
      {dashboard.data.dailyNote && <section className="card daily-note"><div className="eyebrow">今日回顾</div><p>{dashboard.data.dailyNote}</p></section>}
    </div>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = { completed: "已完成", learning: "学习中", planned: "计划中", review: "待复习", blocked: "待解锁" };
  return labels[status] ?? status;
}
