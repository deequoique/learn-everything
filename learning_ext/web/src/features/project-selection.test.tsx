import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api, ApiRequestError } from "../api/client";
import type { HomeData, Project } from "../api/contracts";
import { ProjectProvider, useProject } from "../app/ProjectContext";
import { ProjectManagerPage } from "./courses/CoursePages";
import { projectMarker } from "./courses/projectPresentation";
import { HomePage } from "./home/HomePage";

function makeProject(id: string, updatedAt: string): Project {
  return {
    id,
    title: "同名计划",
    description: `计划 ${id} 的说明`,
    status: "active",
    progress: 0.25,
    completedCount: 1,
    nodeCount: 4,
    dueReviewCount: 0,
    createdAt: updatedAt,
    updatedAt,
  };
}

function SelectionProbe() {
  const { selectedProjectId } = useProject();
  return <output aria-label="当前选择">{selectedProjectId ?? "empty"}</output>;
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderManager() {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/courses/projects"]}>
        <ProjectProvider>
          <SelectionProbe />
          <Routes>
            <Route path="/courses/projects" element={<ProjectManagerPage />} />
            <Route path="/courses/plan" element={<div>路线页</div>} />
          </Routes>
        </ProjectProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("current project selection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("clears a stale persisted selection and falls back deterministically", async () => {
    const projects = [makeProject("first", "2026-08-19T08:00:00Z"), makeProject("second", "2026-08-18T08:00:00Z")];
    window.localStorage.setItem("le:selected-project", "already-deleted");
    vi.spyOn(api, "projects").mockResolvedValue(projects);

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter><ProjectProvider><SelectionProbe /></ProjectProvider></MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText("当前选择")).toHaveTextContent("first"));
    await waitFor(() => expect(window.localStorage.getItem("le:selected-project")).toBe("first"));
  });

  it("selects the exact same-title project before opening its roadmap", async () => {
    const first = makeProject("first", "2026-08-19T08:00:00Z");
    const second = makeProject("second", "2026-08-18T08:00:00Z");
    window.localStorage.setItem("le:selected-project", first.id);
    vi.spyOn(api, "projects").mockResolvedValue([first, second]);
    renderManager();

    await userEvent.click(await screen.findByRole("button", { name: `打开学习计划 同名计划 ${projectMarker(second.id)}` }));

    expect(await screen.findByText("路线页")).toBeInTheDocument();
    expect(screen.getByLabelText("当前选择")).toHaveTextContent(second.id);
    expect(window.localStorage.getItem("le:selected-project")).toBe(second.id);
  });

  it("distinguishes same-title plans, shows delete progress and selects the next plan", async () => {
    const first = makeProject("first", "2026-08-19T08:00:00Z");
    const second = makeProject("second", "2026-08-18T08:00:00Z");
    let projects = [first, second];
    let finishDelete: (() => void) | undefined;
    window.localStorage.setItem("le:selected-project", first.id);
    vi.spyOn(api, "projects").mockImplementation(async () => projects);
    vi.spyOn(api, "deleteProject").mockImplementation((id) => new Promise<void>((resolve) => {
      finishDelete = () => {
        projects = projects.filter((project) => project.id !== id);
        resolve();
      };
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderManager();

    expect(await screen.findByText(new RegExp(projectMarker(first.id)))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(projectMarker(second.id)))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `删除学习计划 同名计划 ${projectMarker(first.id)}` }));
    expect(screen.getByRole("button", { name: `正在删除学习计划 同名计划 ${projectMarker(first.id)}` })).toBeDisabled();
    finishDelete?.();

    expect(await screen.findByText(/^已删除学习计划“同名计划”/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("heading", { name: "同名计划" })).toHaveLength(1));
    expect(screen.getByLabelText("当前选择")).toHaveTextContent(second.id);
    expect(window.localStorage.getItem("le:selected-project")).toBe(second.id);
  });

  it("keeps the current selection when deleting a different plan", async () => {
    const first = makeProject("first", "2026-08-19T08:00:00Z");
    const second = makeProject("second", "2026-08-18T08:00:00Z");
    let projects = [first, second];
    window.localStorage.setItem("le:selected-project", first.id);
    vi.spyOn(api, "projects").mockImplementation(async () => projects);
    vi.spyOn(api, "deleteProject").mockImplementation(async (id) => {
      projects = projects.filter((project) => project.id !== id);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderManager();

    await userEvent.click(await screen.findByRole("button", { name: `删除学习计划 同名计划 ${projectMarker(second.id)}` }));

    expect(await screen.findByText(/^已删除学习计划“同名计划”/)).toBeInTheDocument();
    expect(screen.getByLabelText("当前选择")).toHaveTextContent(first.id);
    expect(window.localStorage.getItem("le:selected-project")).toBe(first.id);
  });

  it("clears the current selection when deleting the last plan", async () => {
    const project = makeProject("only", "2026-08-19T08:00:00Z");
    let projects = [project];
    window.localStorage.setItem("le:selected-project", project.id);
    vi.spyOn(api, "projects").mockImplementation(async () => projects);
    vi.spyOn(api, "deleteProject").mockImplementation(async () => {
      projects = [];
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderManager();

    await userEvent.click(await screen.findByRole("button", { name: `删除学习计划 同名计划 ${projectMarker(project.id)}` }));

    expect(await screen.findByText(/^已删除学习计划“同名计划”/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("当前选择")).toHaveTextContent("empty"));
    expect(window.localStorage.getItem("le:selected-project")).toBeNull();
  });

  it("does not turn a successful delete into an error when background refresh fails", async () => {
    const project = makeProject("only", "2026-08-19T08:00:00Z");
    let requestCount = 0;
    vi.spyOn(api, "projects").mockImplementation(async () => {
      requestCount += 1;
      if (requestCount > 1) throw new ApiRequestError("刷新失败");
      return [project];
    });
    vi.spyOn(api, "deleteProject").mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderManager();

    await userEvent.click(await screen.findByRole("button", { name: `删除学习计划 同名计划 ${projectMarker(project.id)}` }));

    expect(await screen.findByText(/^已删除学习计划“同名计划”/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the plan and displays a useful delete error", async () => {
    const project = makeProject("first", "2026-08-19T08:00:00Z");
    vi.spyOn(api, "projects").mockResolvedValue([project]);
    vi.spyOn(api, "deleteProject").mockRejectedValue(new ApiRequestError("数据库暂时不可用"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderManager();

    await userEvent.click(await screen.findByRole("button", { name: `删除学习计划 同名计划 ${projectMarker(project.id)}` }));

    expect(await screen.findByRole("alert")).toHaveTextContent("删除失败：数据库暂时不可用");
    expect(screen.getByRole("heading", { name: "同名计划" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `删除学习计划 同名计划 ${projectMarker(project.id)}` })).toBeEnabled();
  });

  it("loads Today for the persisted project and navigates to that project's next node", async () => {
    const first = makeProject("first", "2026-08-19T08:00:00Z");
    const second = makeProject("second", "2026-08-18T08:00:00Z");
    window.localStorage.setItem("le:selected-project", second.id);
    vi.spyOn(api, "projects").mockResolvedValue([first, second]);
    const selectedHome: HomeData = {
      status: "active",
      configured: true,
      project: second,
      nextNode: {
        id: "second-node",
        courseCode: "2.1",
        title: "第二个计划的下一节",
        stageId: "stage",
        stageTitle: "阶段",
        status: "learning",
        summary: null,
        description: null,
        content: null,
        practice: null,
        note: null,
        resources: [],
        estimatedMinutes: 30,
      },
      dueReviewCount: 0,
      completedToday: 0,
      streakDays: 0,
    };
    const home = vi.spyOn(api, "home").mockResolvedValue(selectedHome);

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter><ProjectProvider><HomePage /></ProjectProvider></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: second.title })).toBeInTheDocument();
    expect(home).toHaveBeenCalledWith(second.id);
    expect(within(screen.getByText("第二个计划的下一节").closest("section")!).getByRole("link", { name: /继续这一节/ })).toHaveAttribute("href", "/courses/second/nodes/second-node");
  });
});
