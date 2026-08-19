export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const percentage = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return <div className="progress-wrap">{label && <div className="progress-label"><span>{label}</span><strong>{percentage}%</strong></div>}<div className="progress-track"><span style={{ width: `${percentage}%` }} /></div></div>;
}
