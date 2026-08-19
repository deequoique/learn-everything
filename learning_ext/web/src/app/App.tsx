import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { queryClient } from "./queryClient";
import { ProjectProvider } from "./ProjectContext";
import { AppShell } from "./AppShell";
import { HomePage } from "../features/home/HomePage";
import { CoursesPage, ProjectManagerPage, RoadmapPage, WorkbenchPage } from "../features/courses/CoursePages";
import { ReviewPage } from "../features/review/ReviewPage";
import { ChatPage } from "../features/chat/ChatPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { HelpPage } from "../features/help/HelpPage";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ProjectProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/courses" element={<CoursesPage />} />
              <Route path="/courses/plan" element={<RoadmapPage />} />
              <Route path="/courses/projects" element={<ProjectManagerPage />} />
              <Route path="/courses/:projectId/nodes/:nodeId" element={<WorkbenchPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ProjectProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
