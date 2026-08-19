import { NavLink, Outlet, useLocation } from "react-router-dom";
import { BookOpen, Brain, ChartNoAxesCombined, CircleHelp, Database, Home, Layers3, Settings2, Sparkles } from "lucide-react";
import { useProject } from "./ProjectContext";
import { projectMarker } from "../features/courses/projectPresentation";

const navigation = [
  { to: "/", label: "今日", icon: Home, end: true },
  { to: "/courses", label: "课程", icon: BookOpen, end: false },
  { to: "/review", label: "复习", icon: Brain, end: false },
  { to: "/chat", label: "知识问答", icon: Sparkles, end: false },
  { to: "/library", label: "资料库", icon: Database, end: false },
  { to: "/dashboard", label: "学习进度", icon: ChartNoAxesCombined, end: false },
  { to: "/settings", label: "模型配置", icon: Settings2, end: false },
  { to: "/help", label: "使用帮助", icon: CircleHelp, end: false },
] as const;

export function AppShell() {
  const location = useLocation();
  const { selectedProject, selectedProjectId } = useProject();
  const project = selectedProject;
  const activeLabel = navigation.find((item) => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))?.label ?? "学习驾驶舱";

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><Layers3 size={18} strokeWidth={2.4} /></div>
          <div><strong>LearnEverything</strong><span>学习驾驶舱</span></div>
        </div>
        <div className="sidebar-project" aria-label="当前项目">
          <span className="eyebrow">当前项目</span>
          <strong>{project?.title ?? (selectedProjectId ? "正在载入课程" : "还没有学习计划")}</strong>
          <span className="sidebar-project-meta">{project ? `${Math.round(project.progress * 100)}% 已完成 · ${projectMarker(project.id)}` : "从今日开始设置"}</span>
        </div>
        <nav className="nav-list">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item${isActive ? " is-active" : ""}`}>
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" aria-hidden="true" /> 本地数据 · 安全保存
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><Layers3 size={16} /></span><strong>LearnEverything</strong></div>
          <div className="topbar-title"><span className="topbar-kicker">学习轨迹</span><span>{activeLabel}</span></div>
          <div className="topbar-context">{project ? <><span className="context-pulse" />{project.title}</> : "准备开始"}</div>
        </header>
        <nav className="mobile-nav" aria-label="移动端主导航">
          {navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `mobile-nav-item${isActive ? " is-active" : ""}`}><Icon size={16} /><span>{label}</span></NavLink>)}
        </nav>
        <main className="page-main"><Outlet /></main>
      </div>
    </div>
  );
}
