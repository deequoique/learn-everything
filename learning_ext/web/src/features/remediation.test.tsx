import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { ChatPage } from "./chat/ChatPage";
import { LibraryPage } from "./library/LibraryPage";
import { NodeAssistantDrawer } from "./courses/NodeAssistantDrawer";
import { WorkbenchPage } from "./courses/CoursePages";
import { SettingsPage } from "./settings/SettingsPage";

function renderWithClient(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{element}</MemoryRouter></QueryClientProvider>);
}

function eventResponse(events: string[]) {
  return new Response(events.join("\n\n") + "\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("remediation controls", () => {
  it("renames conversations through the existing PATCH API", async () => {
    vi.spyOn(api, "conversations").mockResolvedValue([{ id: "c1", title: "旧名字", updatedAt: null, messageCount: 0, messages: [], fileIds: null }]);
    vi.spyOn(api, "files").mockResolvedValue([]);
    const update = vi.spyOn(api, "updateConversation").mockResolvedValue({ id: "c1", title: "新名字", updatedAt: null, messageCount: 0, messages: [], fileIds: null });
    vi.spyOn(window, "prompt").mockReturnValue("新名字");
    renderWithClient(<ChatPage />);

    await userEvent.click(await screen.findByRole("button", { name: "重命名对话 旧名字" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("c1", "新名字"));
  });

  it("renames library groups without replacing their file membership", async () => {
    vi.spyOn(api, "files").mockResolvedValue([]);
    vi.spyOn(api, "groups").mockResolvedValue([{ id: "g1", indexId: "1", name: "核心", fileIds: ["f1"], createdAt: null }]);
    const update = vi.spyOn(api, "updateGroup").mockResolvedValue({ id: "g1", indexId: "1", name: "必读", fileIds: ["f1"], createdAt: null });
    vi.spyOn(window, "prompt").mockReturnValue("必读");
    renderWithClient(<LibraryPage />);

    await userEvent.click(await screen.findByRole("button", { name: "重命名分组 核心" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("g1", { name: "必读" }));
  });

  it("saves embedding and endpoint settings without sending a stored key back", async () => {
    vi.spyOn(api, "configStatus").mockResolvedValue({
      configured: true,
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.example.com/v1",
      chatModel: "gpt-4o-mini",
      embeddingModel: "old-embedding",
      embeddingReady: true,
      capabilities: ["chat", "rag"],
    });
    const save = vi.spyOn(api, "saveConfig").mockResolvedValue({ configured: true, provider: "openai", model: "gpt-4o-mini", embeddingReady: true, capabilities: ["chat", "rag"] });
    renderWithClient(<SettingsPage />);

    await userEvent.click(await screen.findByText("高级模型设置"));
    const embedding = screen.getByLabelText("Embedding 模型");
    await userEvent.clear(embedding);
    await userEvent.type(embedding, "text-embedding-3-small");
    await userEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toEqual(expect.objectContaining({
      apiKey: undefined,
      baseUrl: "https://api.example.com/v1",
      embeddingModel: "text-embedding-3-small",
    }));
  });
});

describe("node workbench AI", () => {
  it("returns keyboard focus to the workbench trigger after closing the drawer", async () => {
    vi.spyOn(api, "node").mockResolvedValue({ id: "12", courseCode: "2.3", title: "生成器", stageId: "base", stageTitle: "基础", status: "learning", summary: null, description: "正文", content: "正文", practice: null, note: null, resources: [], estimatedMinutes: 30 });
    vi.spyOn(api, "note").mockResolvedValue({ note: "" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/courses/7/nodes/12"]}>
          <Routes><Route path="/courses/:projectId/nodes/:nodeId" element={<WorkbenchPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const trigger = await screen.findByRole("button", { name: "问本节助教" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "关闭 AI 助教" }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("sends current project and node context through the real chat stream path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(eventResponse([
      'event: start\ndata: {"request_id":"r1","kind":"chat"}',
      'event: delta\ndata: {"text":"结合本节的回答"}',
      'event: done\ndata: {"status":"completed"}',
    ]));
    render(<NodeAssistantDrawer nodeId="12" projectId="7" nodeTitle="生成器" onClose={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "用更直白的话解释关键概念" }));

    await waitFor(() => expect(screen.getByText("结合本节的回答")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/stream", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({ project_id: 7, node_id: 12, file_ids: [] });
  });

  it("aborts the assistant request from its stop control", async () => {
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    render(<NodeAssistantDrawer nodeId="12" projectId="7" nodeTitle="生成器" onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "这节最容易踩什么坑？" }));

    await userEvent.click(await screen.findByRole("button", { name: "停止" }));

    await waitFor(() => expect(observedSignal?.aborted).toBe(true));
  });

  it("exposes node resource generation and refreshes the workbench after SSE completion", async () => {
    vi.spyOn(api, "node").mockResolvedValue({ id: "12", courseCode: "2.3", title: "生成器", stageId: "base", stageTitle: "基础", status: "learning", summary: null, description: "正文", content: "正文", practice: null, note: null, resources: [], estimatedMinutes: 30 });
    vi.spyOn(api, "note").mockResolvedValue({ note: "" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(eventResponse([
      'event: start\ndata: {"request_id":"r2","kind":"node-resources"}',
      'event: progress\ndata: {"phase":"resources","message":"正在查找","current":0,"total":2}',
      'event: result\ndata: {"kind":"node-resources","payload":{"resources":[]}}',
      'event: done\ndata: {"status":"completed"}',
    ]));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/courses/7/nodes/12"]}>
          <Routes><Route path="/courses/:projectId/nodes/:nodeId" element={<WorkbenchPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "生成参考资料" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/nodes/12/resources/stream", expect.objectContaining({ method: "POST" })));
  });
});
