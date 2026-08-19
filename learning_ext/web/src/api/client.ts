import {
  configStatusSchema,
  dashboardSchema,
  normalizeConversation,
  normalizeHome,
  normalizeLibraryFile,
  normalizeLibraryGroup,
  normalizeNode,
  normalizeProject,
  normalizeRoadmap,
  reviewCardSchema,
  reviewStatsSchema,
  type ConfigStatus,
  type Conversation,
  type CourseNode,
  type DashboardData,
  type HomeData,
  type LibraryFile,
  type LibraryGroup,
  type Project,
  type ReviewCard,
  type ReviewStats,
} from "./contracts";

export class ApiRequestError extends Error {
  code: string;
  retryable: boolean;
  status: number;

  constructor(message: string, status = 500, code = "REQUEST_FAILED", retryable = true) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

async function request<T>(path: string, init: RequestInit = {}, decode?: (value: unknown) => T): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const error = typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
    const detail = typeof error.detail === "object" && error.detail !== null ? error.detail as Record<string, unknown> : error;
    throw new ApiRequestError(typeof detail.message === "string" ? detail.message : `请求失败（${response.status}）`, response.status, typeof detail.code === "string" ? detail.code : "REQUEST_FAILED", detail.retryable !== false);
  }
  return decode ? decode(payload) : payload as T;
}

function arrayPayload(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    for (const candidateKey of [key, "items"]) {
      const candidate = source[candidateKey];
      if (Array.isArray(candidate)) return candidate;
    }
  }
  return [];
}

export const api = {
  health: () => request<{ ok: boolean; service?: string }>("/api/health"),
  home: (projectId?: string) => request<HomeData>(`/api/home${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`, {}, normalizeHome),
  projects: () => request<Project[]>("/api/projects", {}, (value) => arrayPayload(value, "projects").map(normalizeProject)),
  project: (id: string) => request<Project>(`/api/projects/${encodeURIComponent(id)}`, {}, normalizeProject),
  deleteProject: (id: string) => request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  importProject: (payload: string) => request<Project>("/api/projects/import", { method: "POST", body: JSON.stringify({ payload }) }, normalizeProject),
  roadmap: (id: string) => request(`/api/projects/${encodeURIComponent(id)}/roadmap`, {}, (value) => normalizeRoadmap(value, undefined)),
  nodes: (id: string) => request<CourseNode[]>(`/api/projects/${encodeURIComponent(id)}/nodes`, {}, (value) => arrayPayload(value, "nodes").map((item) => normalizeNode(item))),
  node: (id: string) => request<CourseNode>(`/api/nodes/${encodeURIComponent(id)}`, {}, normalizeNode),
  updateNodeStatus: (id: string, status: string) => request<CourseNode>(`/api/nodes/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, normalizeNode),
  note: (id: string) => request<{ note: string }>(`/api/nodes/${encodeURIComponent(id)}/note`),
  saveNote: (id: string, note: string) => request<{ note: string }>(`/api/nodes/${encodeURIComponent(id)}/note`, { method: "PUT", body: JSON.stringify({ note }) }),
  reviewStats: () => request<ReviewStats>("/api/review/stats", {}, (value) => reviewStatsSchema.parse(value)),
  nextReview: () => request<ReviewCard | null>("/api/review/next", {}, (value) => {
    if (value === null || value === undefined) return null;
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return reviewCardSchema.parse({ id: String(source.id ?? source.card_id ?? ""), prompt: String(source.prompt ?? source.question ?? ""), answer: String(source.answer ?? ""), sourceTitle: source.sourceTitle ?? source.source_title ?? null, dueAt: source.dueAt ?? source.due_at ?? null });
  }),
  rateReview: (id: string, rating: number) => request<{ next?: ReviewCard | null }>(`/api/review/${encodeURIComponent(id)}/rate`, { method: "POST", body: JSON.stringify({ rating }) }),
  dashboard: (projectId?: string) => request<DashboardData>(`/api/dashboard${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`, {}, (value) => dashboardSchema.parse(value)),
  configStatus: () => request<ConfigStatus>("/api/config/status", {}, (value) => configStatusSchema.parse(value)),
  saveConfig: (input: { provider: string; model: string; apiKey?: string; baseUrl?: string; embeddingModel?: string }) => request<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify(input) }, (value) => configStatusSchema.parse(value)),
  testConfig: (input: { provider: string; model: string; apiKey?: string; baseUrl?: string; embeddingModel?: string }) => request<{ ok: boolean; message: string }>("/api/config/test", { method: "POST", body: JSON.stringify(input) }),
  conversations: () => request<Conversation[]>("/api/chat/conversations", {}, (value) => arrayPayload(value, "conversations").map(normalizeConversation)),
  conversation: (id: string) => request<Conversation>(`/api/chat/conversations/${encodeURIComponent(id)}`, {}, normalizeConversation),
  createConversation: (title = "新对话") => request<Conversation>("/api/chat/conversations", { method: "POST", body: JSON.stringify({ title }) }, normalizeConversation),
  updateConversation: (id: string, title: string) => request<Conversation>(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) }, normalizeConversation),
  deleteConversation: (id: string) => request<void>(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  files: () => request<LibraryFile[]>("/api/library/files", {}, (value) => arrayPayload(value, "files").map(normalizeLibraryFile)),
  deleteFile: (id: string) => request<void>(`/api/library/files/${encodeURIComponent(id)}`, { method: "DELETE" }),
  groups: () => request<LibraryGroup[]>("/api/library/groups", {}, (value) => arrayPayload(value, "groups").map(normalizeLibraryGroup)),
  createGroup: (input: { indexId: string; name: string; fileIds: string[] }) => request<LibraryGroup>("/api/library/groups", { method: "POST", body: JSON.stringify({ index_id: input.indexId, name: input.name, file_ids: input.fileIds }) }, normalizeLibraryGroup),
  updateGroup: (id: string, input: { name?: string; fileIds?: string[] }) => request<LibraryGroup>(`/api/library/groups/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name: input.name, file_ids: input.fileIds }) }, normalizeLibraryGroup),
  deleteGroup: (id: string) => request<void>(`/api/library/groups/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const projectKeys = {
  all: ["projects"] as const,
  list: () => [...projectKeys.all, "list"] as const,
  detail: (id: string) => [...projectKeys.all, "detail", id] as const,
  roadmap: (id: string) => [...projectKeys.all, "roadmap", id] as const,
  nodes: (id: string) => [...projectKeys.all, "nodes", id] as const,
};

export const homeKeys = {
  all: ["home"] as const,
  detail: (projectId?: string) => [...homeKeys.all, projectId ?? "empty"] as const,
};

export const dashboardKeys = {
  all: ["dashboard"] as const,
  detail: (projectId?: string) => [...dashboardKeys.all, projectId ?? "empty"] as const,
};

export const reviewKeys = {
  stats: ["review", "stats"] as const,
  next: ["review", "next"] as const,
};
