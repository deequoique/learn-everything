import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProjectProvider, useProject } from "../../app/ProjectContext";
import { api } from "../../api/client";
import { streamJson } from "../../api/stream";
import type { Project } from "../../api/contracts";
import { makeRoadmap } from "../../test/factories";
import { RoadmapPage } from "./CoursePages";

vi.mock("../../api/stream", () => ({ streamJson: vi.fn() }));

function makeProject(id: string, title: string): Project {
  return {
    id,
    title,
    description: `${title}的说明`,
    status: "active",
    progress: 0.25,
    completedCount: 1,
    nodeCount: 4,
    dueReviewCount: 0,
    createdAt: "2026-08-19T08:00:00Z",
    updatedAt: "2026-08-19T08:00:00Z",
  };
}

function SelectionProbe() {
  const { selectedProjectId } = useProject();
  return <output aria-label="当前选择">{selectedProjectId ?? "empty"}</output>;
}

function renderRoadmap(projectsSource: () => Project[] | Promise<Project[]>) {
  vi.spyOn(api, "projects").mockImplementation(async () => projectsSource());
  vi.spyOn(api, "roadmap").mockImplementation(async () => makeRoadmap(2));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/courses/plan"]}>
        <ProjectProvider>
          <SelectionProbe />
          <RoadmapPage />
        </ProjectProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

describe("learning plan creation entry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(streamJson).mockReset();
    window.localStorage.clear();
    vi.stubGlobal("IntersectionObserver", class {
      observe() { return undefined; }
      disconnect() { return undefined; }
      unobserve() { return undefined; }
    });
  });

  it("keeps a clearly labelled creation entry visible beside an existing roadmap", async () => {
    const current = makeProject("current", "当前路线");
    window.localStorage.setItem("le:selected-project", current.id);
    renderRoadmap(() => [current]);

    expect(await screen.findByRole("heading", { name: current.title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建学习计划" })).toBeVisible();
  });

  it("opens an accessible dialog, closes with Escape, and returns focus to its trigger", async () => {
    const current = makeProject("current", "当前路线");
    window.localStorage.setItem("le:selected-project", current.id);
    renderRoadmap(() => [current]);
    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: "新建学习计划" });

    await user.click(trigger);

    expect(screen.getByRole("dialog", { name: "新建学习计划" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("我想学什么？")).toHaveFocus();
    expect(screen.getByRole("button", { name: "关闭新建学习计划" })).toBeVisible();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建学习计划" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("traps keyboard focus and closes from the backdrop", async () => {
    const current = makeProject("current", "当前路线");
    window.localStorage.setItem("le:selected-project", current.id);
    renderRoadmap(() => [current]);
    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: "新建学习计划" });

    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "新建学习计划" });
    const close = screen.getByRole("button", { name: "关闭新建学习计划" });
    const submit = screen.getByRole("button", { name: "生成并保存路线" });
    await user.type(screen.getByLabelText("我想学什么？"), "数据分析");
    close.focus();
    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    fireEvent.mouseDown(dialog.parentElement!);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("selects and displays the newly generated roadmap without a manual refresh", async () => {
    const current = makeProject("current", "当前路线");
    const created = makeProject("created", "新生成路线");
    let projects = [current];
    window.localStorage.setItem("le:selected-project", current.id);
    vi.mocked(streamJson).mockImplementation(async (_url, _body, options) => {
      options.onEvent({ type: "start", requestId: "create-1", task: "roadmap" });
      projects = [created, current];
      options.onEvent({ type: "result", result: { project_id: created.id } });
      options.onEvent({ type: "done", status: "completed" });
    });
    const { queryClient } = renderRoadmap(() => projects);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "新建学习计划" }));
    await user.type(screen.getByLabelText("我想学什么？"), "数据分析");
    await user.click(screen.getByRole("button", { name: "生成并保存路线" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建学习计划" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("当前选择")).toHaveTextContent(created.id);
    expect(await screen.findByRole("heading", { name: created.title })).toBeInTheDocument();
    expect(window.localStorage.getItem("le:selected-project")).toBe(created.id);
    expect(streamJson).toHaveBeenCalledTimes(1);
    expect(api.roadmap).toHaveBeenCalledWith(created.id);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["projects"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["home"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });

  it("recovers from a project-list refresh failure without generating twice", async () => {
    const current = makeProject("current", "当前路线");
    const created = makeProject("created", "已生成路线");
    let listAttempt = 0;
    window.localStorage.setItem("le:selected-project", current.id);
    vi.mocked(streamJson).mockImplementation(async (_url, _body, options) => {
      options.onEvent({ type: "start", requestId: "create-refresh", task: "roadmap" });
      options.onEvent({ type: "result", result: { project_id: created.id } });
      options.onEvent({ type: "done", status: "completed" });
    });
    renderRoadmap(() => {
      listAttempt += 1;
      if (listAttempt === 2) throw new Error("项目列表暂时不可用");
      return listAttempt >= 3 ? [created, current] : [current];
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "新建学习计划" }));
    await user.type(screen.getByLabelText("我想学什么？"), "数据分析");
    await user.click(screen.getByRole("button", { name: "生成并保存路线" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("项目列表暂时没有刷新");
    expect(screen.getByRole("button", { name: "重新载入已生成路线" })).toBeEnabled();
    expect(screen.getByLabelText("当前选择")).toHaveTextContent(current.id);
    await user.click(screen.getByRole("button", { name: "重新载入已生成路线" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建学习计划" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("当前选择")).toHaveTextContent(created.id);
    expect(streamJson).toHaveBeenCalledTimes(1);
  });

  it("keeps the prior roadmap selected after a generation failure and offers retry", async () => {
    const current = makeProject("current", "当前路线");
    window.localStorage.setItem("le:selected-project", current.id);
    vi.mocked(streamJson).mockRejectedValue(new Error("模型暂时不可用"));
    renderRoadmap(() => [current]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "新建学习计划" }));
    await user.type(screen.getByLabelText("我想学什么？"), "数据分析");
    await user.click(screen.getByRole("button", { name: "生成并保存路线" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("模型暂时不可用");
    expect(screen.getByRole("button", { name: "重试生成" })).toBeEnabled();
    expect(screen.getByLabelText("当前选择")).toHaveTextContent(current.id);
    expect(screen.getByRole("heading", { name: current.title })).toBeInTheDocument();
  });

  it("aborts generation without changing the prior roadmap and keeps a retry state", async () => {
    const current = makeProject("current", "当前路线");
    window.localStorage.setItem("le:selected-project", current.id);
    vi.mocked(streamJson).mockImplementation((_url, _body, options) => new Promise<void>((_resolve, reject) => {
      options.onEvent({ type: "start", requestId: "create-2", task: "roadmap" });
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    renderRoadmap(() => [current]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "新建学习计划" }));
    await user.type(screen.getByLabelText("我想学什么？"), "数据分析");
    await user.click(screen.getByRole("button", { name: "生成并保存路线" }));
    await user.click(await screen.findByRole("button", { name: "取消生成" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("已取消生成，当前学习计划没有改变");
    expect(screen.getByRole("button", { name: "重试生成" })).toBeEnabled();
    expect(screen.getByLabelText("当前选择")).toHaveTextContent(current.id);
  });

  it("aborts an active generation when the drawer closes or the page unmounts", async () => {
    const current = makeProject("current", "当前路线");
    const signals: AbortSignal[] = [];
    window.localStorage.setItem("le:selected-project", current.id);
    vi.mocked(streamJson).mockImplementation((_url, _body, options) => new Promise<void>((_resolve, reject) => {
      signals.push(options.signal!);
      options.onEvent({ type: "start", requestId: `create-${signals.length}`, task: "roadmap" });
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const rendered = renderRoadmap(() => [current]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "新建学习计划" }));
    await user.type(screen.getByLabelText("我想学什么？"), "数据分析");
    await user.click(screen.getByRole("button", { name: "生成并保存路线" }));
    await user.click(screen.getByRole("button", { name: "关闭新建学习计划" }));
    await waitFor(() => expect(signals[0]?.aborted).toBe(true));
    expect(screen.getByLabelText("当前选择")).toHaveTextContent(current.id);

    await user.click(screen.getByRole("button", { name: "新建学习计划" }));
    await user.type(screen.getByLabelText("我想学什么？"), "机器学习");
    await user.click(screen.getByRole("button", { name: "生成并保存路线" }));
    rendered.unmount();
    expect(signals[1]?.aborted).toBe(true);
  });

  it("does not switch projects when the drawer closes during finalization", async () => {
    const current = makeProject("current", "当前路线");
    const created = makeProject("created", "新生成路线");
    let listAttempt = 0;
    let finishRefresh!: (projects: Project[]) => void;
    window.localStorage.setItem("le:selected-project", current.id);
    vi.mocked(streamJson).mockImplementation(async (_url, _body, options) => {
      options.onEvent({ type: "start", requestId: "create-finalize", task: "roadmap" });
      options.onEvent({ type: "result", result: { project_id: created.id } });
      options.onEvent({ type: "done", status: "completed" });
    });
    renderRoadmap(() => {
      listAttempt += 1;
      if (listAttempt === 1) return [current];
      return new Promise<Project[]>((resolve) => { finishRefresh = resolve; });
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "新建学习计划" }));
    await user.type(screen.getByLabelText("我想学什么？"), "数据分析");
    await user.click(screen.getByRole("button", { name: "生成并保存路线" }));
    expect(await screen.findByRole("button", { name: "正在打开新路线…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "关闭新建学习计划" }));
    finishRefresh([created, current]);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建学习计划" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("当前选择")).toHaveTextContent(current.id));
    expect(window.localStorage.getItem("le:selected-project")).toBe(current.id);
  });

  it("prevents duplicate generation when the form submits twice", async () => {
    const current = makeProject("current", "当前路线");
    window.localStorage.setItem("le:selected-project", current.id);
    vi.mocked(streamJson).mockImplementation((_url, _body, options) => new Promise<void>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const rendered = renderRoadmap(() => [current]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "新建学习计划" }));
    await user.type(screen.getByLabelText("我想学什么？"), "数据分析");
    const form = screen.getByLabelText("我想学什么？").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(streamJson).toHaveBeenCalledTimes(1);
    rendered.unmount();
  });

  it("shows the creation form directly when there are no projects", async () => {
    renderRoadmap(() => []);

    expect(await screen.findByRole("heading", { name: "先创建一条路线" })).toBeInTheDocument();
    expect(screen.getByLabelText("我想学什么？")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
