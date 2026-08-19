import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";

export function LoadingState({ label = "正在载入" }: { label?: string }) {
  return <div className="async-state" role="status"><LoaderCircle className="spin" size={20} /><span>{label}…</span></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="async-state async-error" role="alert"><AlertTriangle size={20} /><div><strong>页面暂时没有准备好</strong><span>{message}</span>{onRetry && <button className="button button-quiet" onClick={onRetry}><RefreshCw size={15} />再试一次</button>}</div></div>;
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-orbit" aria-hidden="true" /><h3>{title}</h3><p>{message}</p>{action}</div>;
}
