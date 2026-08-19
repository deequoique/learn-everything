import { z } from "zod";

export const streamEventTypes = ["start", "progress", "delta", "citation", "result", "error", "done"] as const;
export type StreamEventType = (typeof streamEventTypes)[number];

const optionalString = z.string().optional().nullable();
const optionalPage = z.union([z.string(), z.number()]).optional().nullable();

export const apiErrorSchema = z.object({
  code: z.string().default("REQUEST_FAILED"),
  message: z.string().default("请求没有完成，请稍后重试。"),
  retryable: z.boolean().optional().default(true),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: optionalString,
  status: z.string().default("active"),
  progress: z.number().min(0).max(1).default(0),
  completedCount: z.number().int().nonnegative().default(0),
  nodeCount: z.number().int().nonnegative().default(0),
  dueReviewCount: z.number().int().nonnegative().default(0),
  createdAt: optionalString,
  updatedAt: optionalString,
});
export type Project = z.infer<typeof projectSchema>;

export const nodeSchema = z.object({
  id: z.string(),
  courseCode: z.string(),
  title: z.string(),
  stageId: z.string(),
  stageTitle: z.string(),
  status: z.string().default("planned"),
  summary: optionalString,
  description: optionalString,
  content: optionalString,
  practice: optionalString,
  note: optionalString,
  resources: z.array(z.object({
    id: z.string(),
    title: z.string(),
    url: optionalString,
    type: optionalString,
    description: optionalString,
  })).default([]),
  estimatedMinutes: z.number().int().positive().optional().nullable(),
});
export type CourseNode = z.infer<typeof nodeSchema>;

export const roadmapStageSchema = z.object({
  id: z.string(),
  title: z.string(),
  nodes: z.array(nodeSchema),
});
export type RoadmapStage = z.infer<typeof roadmapStageSchema>;

export const roadmapSchema = z.object({
  project: projectSchema.optional(),
  stages: z.array(roadmapStageSchema),
  nodes: z.array(nodeSchema),
});
export type Roadmap = z.infer<typeof roadmapSchema>;

export const homeSchema = z.object({
  status: z.enum(["setup", "empty", "active", "complete"]),
  configured: z.boolean().default(false),
  project: projectSchema.optional(),
  nextNode: nodeSchema.optional(),
  dueReviewCount: z.number().int().nonnegative().default(0),
  completedToday: z.number().int().nonnegative().default(0),
  streakDays: z.number().int().nonnegative().default(0),
});
export type HomeData = z.infer<typeof homeSchema>;

export const reviewCardSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  answer: z.string(),
  sourceTitle: optionalString,
  dueAt: optionalString,
});
export type ReviewCard = z.infer<typeof reviewCardSchema>;

export const reviewStatsSchema = z.object({
  due: z.number().int().nonnegative().default(0),
  learning: z.number().int().nonnegative().default(0),
  mastered: z.number().int().nonnegative().default(0),
  reviewedToday: z.number().int().nonnegative().default(0),
});
export type ReviewStats = z.infer<typeof reviewStatsSchema>;

export const citationSchema = z.object({
  id: z.string(),
  title: z.string(),
  excerpt: optionalString,
  page: optionalPage,
  resourceId: optionalString,
});
export type Citation = z.infer<typeof citationSchema>;

export const conversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  citations: z.array(citationSchema).default([]),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: optionalString,
  messageCount: z.number().int().nonnegative().default(0),
  messages: z.array(conversationMessageSchema).default([]),
  fileIds: z.array(z.string()).nullable().default(null),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const libraryFileSchema = z.object({
  id: z.string(),
  indexId: z.string().default(""),
  name: z.string(),
  kind: z.string().default("document"),
  size: z.number().nonnegative().default(0),
  status: z.string().default("ready"),
  groupId: optionalString,
  createdAt: optionalString,
});
export type LibraryFile = z.infer<typeof libraryFileSchema>;

export const libraryGroupSchema = z.object({
  id: z.string(),
  indexId: z.string(),
  name: z.string(),
  fileIds: z.array(z.string()).default([]),
  createdAt: optionalString,
});
export type LibraryGroup = z.infer<typeof libraryGroupSchema>;

export const dashboardSchema = z.object({
  project: projectSchema.optional(),
  trend: z.array(z.object({ date: z.string(), minutes: z.number().nonnegative(), completed: z.number().int().nonnegative() })).default([]),
  statusCounts: z.record(z.number().int().nonnegative()).default({}),
  dailyNote: optionalString,
});
export type DashboardData = z.infer<typeof dashboardSchema>;

export const configStatusSchema = z.object({
  configured: z.boolean().default(false),
  provider: optionalString,
  model: optionalString,
  baseUrl: optionalString,
  chatModel: optionalString,
  embeddingModel: optionalString,
  embeddingReady: z.boolean().default(false),
  capabilities: z.array(z.string()).default([]),
});
export type ConfigStatus = z.infer<typeof configStatusSchema>;

export type StreamEvent =
  | { type: "start"; requestId: string; task?: string; meta?: Record<string, unknown> }
  | { type: "progress"; stage: string; completed: number; total?: number; message?: string }
  | { type: "delta"; text: string }
  | { type: "citation"; citation: Citation }
  | { type: "result"; result: unknown }
  | { type: "error"; error: ApiError }
  | { type: "done"; status: "completed" | "cancelled" | "failed"; durationMs?: number };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : {};
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value === null || value === undefined ? fallback : String(value);
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(source: UnknownRecord, keys: string[], fallback = ""): string {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return stringValue(source[key], fallback);
  }
  return fallback;
}

function firstNumber(source: UnknownRecord, keys: string[], fallback = 0): number {
  for (const key of keys) {
    if (typeof source[key] === "number" && Number.isFinite(source[key])) return source[key];
  }
  return fallback;
}

export function courseCodeSortKey(code: string): number[] {
  const matches = code.match(/\d+/g);
  return matches?.map(Number) ?? [Number.MAX_SAFE_INTEGER];
}

export function compareCourseCodes(a: string, b: string): number {
  const left = courseCodeSortKey(a);
  const right = courseCodeSortKey(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return a.localeCompare(b, "zh-CN");
}

export function normalizeProject(value: unknown): Project {
  const source = record(value);
  return projectSchema.parse({
    id: firstString(source, ["id", "project_id", "projectId"], "unknown-project"),
    title: firstString(source, ["title", "name"], "未命名学习计划"),
    description: source.description ?? source.summary ?? null,
    status: firstString(source, ["status", "state"], "active"),
    progress: Math.min(1, Math.max(0, firstNumber(source, ["progress", "progress_ratio"], 0))),
    completedCount: Math.max(0, Math.round(firstNumber(source, ["completedCount", "completed_count"], 0))),
    nodeCount: Math.max(0, Math.round(firstNumber(source, ["nodeCount", "node_count", "total_nodes"], 0))),
    dueReviewCount: Math.max(0, Math.round(firstNumber(source, ["dueReviewCount", "due_review_count"], 0))),
    createdAt: source.createdAt ?? source.created_at ?? null,
    updatedAt: source.updatedAt ?? source.updated_at ?? null,
  });
}

export function normalizeNode(value: unknown, stageFallback?: { id: string; title: string }): CourseNode {
  const source = record(value);
  const courseCode = firstString(source, ["courseCode", "course_code", "code", "number"], "未编号");
  const stage = record(source.stage);
  const scalarStage = typeof source.stage === "string" ? source.stage : undefined;
  const stageId = firstString(source, ["stageId", "stage_id"], scalarStage ?? firstString(stage, ["id", "slug"], stageFallback?.id ?? "stage"));
  const stageTitle = firstString(source, ["stageTitle", "stage_title"], firstString(stage, ["title", "name"], stageFallback?.title ?? "学习阶段"));
  const id = firstString(source, ["id", "node_id", "nodeId"], `draft-${courseCode}`);
  const rawResources = list(source.resources);
  return nodeSchema.parse({
    id,
    courseCode,
    title: firstString(source, ["title", "name"], "未命名节点"),
    stageId,
    stageTitle,
    status: firstString(source, ["status", "state"], "planned"),
    summary: source.summary ?? source.description ?? null,
    description: source.description ?? source.summary ?? null,
    content: source.content ?? source.lesson ?? source.markdown ?? null,
    practice: source.practice ?? source.exercise ?? null,
    note: source.note ?? null,
    resources: rawResources.map((resource, index) => {
      const item = record(resource);
      return {
        id: firstString(item, ["id", "resource_id"], `${id}-resource-${index + 1}`),
        title: firstString(item, ["title", "name"], "参考资料"),
        url: item.url ?? item.href ?? null,
        type: item.type ?? item.rtype ?? null,
        description: item.description ?? null,
      };
    }),
    estimatedMinutes: source.estimatedMinutes ?? source.estimated_minutes ?? null,
  });
}

export function normalizeRoadmap(value: unknown, project?: Project): Roadmap {
  const source = record(value);
  const stageSources = list(source.stages);
  const stages: RoadmapStage[] = stageSources.map((stageValue, index) => {
    const stage = record(stageValue);
    const stageId = firstString(stage, ["id", "stage_id", "slug", "stage"], `stage-${index + 1}`);
    const stageTitle = firstString(stage, ["title", "name", "label"], `阶段 ${index + 1}`);
    const stageNodes = list(stage.nodes ?? stage.items ?? stage.lessons).map((node) => normalizeNode(node, { id: stageId, title: stageTitle }));
    return { id: stageId, title: stageTitle, nodes: stageNodes.sort((a, b) => compareCourseCodes(a.courseCode, b.courseCode)) };
  });
  const knownStages = new Map(stages.map((stage) => [stage.id, stage.title]));
  const standaloneNodes = list(source.nodes ?? source.items ?? value).map((node) => {
    const item = record(node);
    const rawStage = typeof item.stage === "string" ? item.stage : firstString(item, ["stageId", "stage_id"], "stage");
    return normalizeNode(node, { id: rawStage, title: knownStages.get(rawStage) ?? rawStage });
  });
  const byId = new Map<string, CourseNode>();
  for (const node of [...stages.flatMap((stage) => stage.nodes), ...standaloneNodes]) byId.set(node.id, node);
  const nodes = [...byId.values()].sort((a, b) => compareCourseCodes(a.courseCode, b.courseCode));
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  for (const node of nodes) {
    const stage = stageMap.get(node.stageId);
    if (stage && !stage.nodes.some((item) => item.id === node.id)) stage.nodes.push(node);
    if (!stage) stageMap.set(node.stageId, { id: node.stageId, title: node.stageTitle, nodes: [node] });
  }
  const orderedStages = [...stageMap.values()].map((stage) => ({ ...stage, nodes: stage.nodes.sort((a, b) => compareCourseCodes(a.courseCode, b.courseCode)) }));
  return roadmapSchema.parse({ project, stages: orderedStages, nodes });
}

export function normalizeHome(value: unknown): HomeData {
  const source = record(value);
  const projectValue = source.project ?? source.current_project;
  const nextNodeValue = source.nextNode ?? source.next_node;
  const project = projectValue ? normalizeProject(projectValue) : undefined;
  const configured = booleanValue(source.configured ?? source.model_configured, false);
  const statusValue = firstString(source, ["status", "state"], project ? "active" : configured ? "empty" : "setup");
  const status = (["setup", "empty", "active", "complete"] as const).includes(statusValue as never) ? statusValue as HomeData["status"] : project ? "active" : "empty";
  return homeSchema.parse({
    status,
    configured,
    project,
    nextNode: nextNodeValue ? normalizeNode(nextNodeValue) : undefined,
    dueReviewCount: Math.max(0, Math.round(firstNumber(source, ["dueReviewCount", "due_review_count", "due_reviews"], project?.dueReviewCount ?? 0))),
    completedToday: Math.max(0, Math.round(firstNumber(source, ["completedToday", "completed_today"], 0))),
    streakDays: Math.max(0, Math.round(firstNumber(source, ["streakDays", "streak_days"], 0))),
  });
}

export function normalizeCitation(value: unknown): Citation {
  const item = record(value);
  return citationSchema.parse({
    id: firstString(item, ["id", "citation_id"], crypto.randomUUID?.() ?? `citation-${Date.now()}`),
    title: firstString(item, ["title", "name"], "参考资料"),
    excerpt: item.excerpt ?? item.snippet ?? item.text ?? null,
    page: item.page ?? item.page_number ?? null,
    resourceId: item.resourceId ?? item.resource_id ?? item.file_id ?? null,
  });
}

export function normalizeConversation(value: unknown): Conversation {
  const source = record(value);
  const messages = list(source.messages).flatMap((value) => {
    const message = record(value);
    const role = message.role === "user" || message.role === "assistant" ? message.role : null;
    if (role === null) return [];
    return [{
      role,
      text: stringValue(message.text ?? message.content),
      citations: list(message.citations).map(normalizeCitation),
    }];
  });
  const rawFileIds = source.fileIds ?? source.file_ids;
  return conversationSchema.parse({
    id: firstString(source, ["id", "conversation_id"]),
    title: firstString(source, ["title", "name"], "新对话"),
    updatedAt: source.updatedAt ?? source.updated_at ?? null,
    messageCount: Math.max(0, Math.round(firstNumber(source, ["messageCount", "message_count"], messages.length))),
    messages,
    fileIds: rawFileIds === null || rawFileIds === undefined ? null : list(rawFileIds).map(String),
  });
}

export function normalizeLibraryGroup(value: unknown): LibraryGroup {
  const source = record(value);
  return libraryGroupSchema.parse({
    id: firstString(source, ["id", "group_id"]),
    indexId: firstString(source, ["indexId", "index_id"]),
    name: firstString(source, ["name", "title"], "未命名分组"),
    fileIds: list(source.fileIds ?? source.file_ids ?? source.files).map(String),
    createdAt: source.createdAt ?? source.date_created ?? null,
  });
}

export function normalizeLibraryFile(value: unknown): LibraryFile {
  const source = record(value);
  return libraryFileSchema.parse({
    id: firstString(source, ["id", "file_id"]),
    indexId: firstString(source, ["indexId", "index_id"]),
    name: firstString(source, ["name", "title"], "未命名资料"),
    kind: firstString(source, ["kind", "type"], "document"),
    size: Math.max(0, firstNumber(source, ["size"], 0)),
    status: firstString(source, ["status", "state"], "ready"),
    groupId: source.groupId ?? source.group_id ?? null,
    createdAt: source.createdAt ?? source.date_created ?? null,
  });
}

export function normalizeStreamEvent(type: string, value: unknown): StreamEvent {
  const source = record(value);
  switch (type) {
    case "start":
      return { type, requestId: firstString(source, ["requestId", "request_id", "id"], "request"), task: source.task || source.kind ? stringValue(source.task ?? source.kind) : undefined, meta: record(source.meta) };
    case "progress":
      return { type, stage: firstString(source, ["stage", "phase"], "处理中"), completed: Math.max(0, firstNumber(source, ["completed", "current"], 0)), total: source.total === undefined ? undefined : Math.max(0, firstNumber(source, ["total"], 0)), message: source.message ? stringValue(source.message) : undefined };
    case "delta":
      return { type, text: stringValue(source.text ?? source.delta) };
    case "citation": {
      const citation = source.citation ?? value;
      return { type, citation: normalizeCitation(citation) };
    }
    case "result":
      return { type, result: source.payload ?? source.result ?? value };
    case "error":
      return { type, error: apiErrorSchema.parse({ code: source.code, message: source.message, retryable: source.retryable }) };
    case "done": {
      const status = firstString(source, ["status", "state"], "completed");
      return { type, status: status === "cancelled" || status === "failed" ? status : "completed", durationMs: source.durationMs === undefined && source.duration_ms === undefined && source.elapsed_ms === undefined ? undefined : numberValue(source.durationMs ?? source.duration_ms ?? source.elapsed_ms) };
    }
    default:
      throw new Error(`未知的 SSE 事件：${type}`);
  }
}
