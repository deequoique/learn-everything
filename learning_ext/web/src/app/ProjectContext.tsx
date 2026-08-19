import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, projectKeys } from "../api/client";
import type { Project } from "../api/contracts";

interface ProjectContextValue {
  selectedProjectId?: string;
  selectedProject?: Project;
  isProjectSelectionReady: boolean;
  selectProject: (id: string | undefined) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [persistedProjectId, setPersistedProjectId] = useState<string | undefined>(() => {
    try {
      return window.localStorage.getItem("le:selected-project") ?? undefined;
    } catch {
      return undefined;
    }
  });
  const projects = useQuery({ queryKey: projectKeys.list(), queryFn: api.projects });
  const hasProjectList = projects.data !== undefined;
  const selectedProject = projects.data?.find((project) => project.id === persistedProjectId) ?? projects.data?.[0];
  const selectedProjectId = selectedProject?.id;
  const selectProject = useCallback((id: string | undefined) => {
    setPersistedProjectId(id);
    try {
      if (id) window.localStorage.setItem("le:selected-project", id);
      else window.localStorage.removeItem("le:selected-project");
    } catch {
      return;
    }
  }, []);
  useEffect(() => {
    if (!hasProjectList || selectedProjectId === persistedProjectId) return;
    selectProject(selectedProjectId);
  }, [hasProjectList, persistedProjectId, selectProject, selectedProjectId]);
  const value = useMemo(() => ({
    selectedProjectId,
    selectedProject,
    isProjectSelectionReady: hasProjectList,
    selectProject,
  }), [hasProjectList, selectProject, selectedProject, selectedProjectId]);
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProject() {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProject 必须在 ProjectProvider 内使用");
  return value;
}
