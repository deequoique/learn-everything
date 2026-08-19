import type { Project } from "../../api/contracts";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function projectMarker(projectId: string): string {
  let hash = 2166136261;
  for (const character of projectId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

export function formatProjectTime(value?: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : dateTimeFormatter.format(date);
}

export function projectMeta(project: Project): string {
  const created = formatProjectTime(project.createdAt);
  const updated = formatProjectTime(project.updatedAt);
  const dates = created && updated && created !== updated
    ? `创建 ${created} · 更新 ${updated}`
    : `更新 ${updated ?? created ?? "时间未知"}`;
  return `计划标记 ${projectMarker(project.id)} · ${dates}`;
}

export function projectOptionLabel(project: Project): string {
  return `${project.title} · ${projectMarker(project.id)} · ${formatProjectTime(project.updatedAt ?? project.createdAt) ?? "时间未知"}`;
}
