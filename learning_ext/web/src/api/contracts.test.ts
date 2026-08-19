import { describe, expect, it } from "vitest";
import { normalizeConversation, normalizeLibraryGroup, normalizeProject, normalizeRoadmap, normalizeStreamEvent } from "./contracts";

describe("roadmap contract", () => {
  it("sorts numeric course codes and keeps stable persisted node ids", () => {
    const input = Array.from({ length: 50 }, (_, index) => ({ id: `persisted-${index + 1}`, course_code: `2.${index + 1}`, title: `节点 ${index + 1}`, stage_id: "base", stage_title: "基础" })).reverse();
    const roadmap = normalizeRoadmap({ nodes: input });
    expect(roadmap.nodes).toHaveLength(50);
    expect(roadmap.nodes.slice(0, 3).map((node) => node.courseCode)).toEqual(["2.1", "2.2", "2.3"]);
    expect(new Set(roadmap.nodes.map((node) => node.id)).size).toBe(50);
    const codes = roadmap.nodes.map((node) => node.courseCode);
    expect(codes.indexOf("2.10")).toBeGreaterThan(codes.indexOf("2.9"));
  });

  it("maps backend stages without creating an empty duplicate stage", () => {
    const roadmap = normalizeRoadmap({
      stages: [{ stage: "base", name: "基础" }],
      nodes: [{ node_id: 7, code: "1.1", title: "开始", stage: "base" }],
    });

    expect(roadmap.stages).toHaveLength(1);
    expect(roadmap.stages[0]).toMatchObject({ id: "base", title: "基础" });
    expect(roadmap.stages[0].nodes[0]).toMatchObject({ id: "7", stageId: "base" });
  });

  it("uses the numeric progress ratio when the backend also sends a progress detail object", () => {
    const project = normalizeProject({ id: 1, title: "路线", progress: { done: 2, total: 4 }, progress_ratio: 0.5 });
    expect(project.progress).toBe(0.5);
  });

  it("maps backend citation and terminal field names", () => {
    expect(normalizeStreamEvent("citation", { citation_id: "c", file_id: "f", title: "资料", page: "3" })).toMatchObject({
      type: "citation",
      citation: { id: "c", resourceId: "f", page: "3" },
    });
    expect(normalizeStreamEvent("done", { status: "completed", elapsed_ms: 42 })).toMatchObject({ durationMs: 42 });
  });

  it("normalizes persisted conversations, sources, and library groups", () => {
    const conversation = normalizeConversation({
      id: "conversation-1",
      title: "学习记录",
      file_ids: ["file-1"],
      messages: [
        { role: "user", content: "问题" },
        { role: "assistant", content: "回答", citations: [{ citation_id: "c1", file_id: "file-1", title: "资料" }] },
      ],
    });
    const group = normalizeLibraryGroup({ id: "group-1", index_id: "1", name: "核心", file_ids: ["file-1"] });

    expect(conversation.fileIds).toEqual(["file-1"]);
    expect(conversation.messages[1].citations[0]).toMatchObject({ id: "c1", resourceId: "file-1" });
    expect(group).toMatchObject({ indexId: "1", fileIds: ["file-1"] });
  });
});
