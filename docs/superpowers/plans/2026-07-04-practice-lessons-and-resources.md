# Practice Lessons And Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate practical lessons, automatic reference-resource fetching, and numeric course sorting.

**Architecture:** Reuse `Task(task_type="practice")` for practical lessons and keep lecture content in `KnowledgeNode.description`. Put orchestration helpers in `learning_ext.progress.study`, keep resource fetching in `learning_ext.notes.service`, and update the Gradio workbench to render a new tab and trigger background jobs.

**Tech Stack:** Python, SQLModel, Gradio, existing `learning_ext.llm.chat`, existing pytest suite.

## Global Constraints

- Learning-specific code stays under `learning_ext/`.
- Do not modify `kotaemon/`.
- Use `learning_ext.llm.chat/chat_json` for LLM calls.
- Use existing `Task` table for practical lessons.
- Use numeric course-code sorting everywhere changed in this plan.

---

### Task 1: Numeric Course Sorting

**Files:**
- Modify: `learning_ext/progress/study.py`
- Modify: `learning_ext/path_generator/service.py`
- Modify: `learning_ext/pages/study_workbench.py`
- Test: `tests/test_progress_study.py`
- Test: `tests/test_pages.py`

**Interfaces:**
- Produces: `course_code_sort_key(code: str) -> tuple`

- [ ] Write failing tests for `2.1, 2.2, 2.10` ordering.
- [ ] Run focused tests and verify failure.
- [ ] Add `course_code_sort_key`.
- [ ] Replace affected Python-side sorts with the helper.
- [ ] Run focused tests and verify pass.

### Task 2: Practice Lesson Service

**Files:**
- Modify: `learning_ext/progress/study.py`
- Test: `tests/test_progress_study.py`

**Interfaces:**
- Produces: `is_practice_heavy_node(node: KnowledgeNode, project_topic: str = "") -> bool`
- Produces: `get_practice_task(session: Session, node_id: int) -> Task | None`
- Produces: `generate_practice_lesson(node: KnowledgeNode, project_topic: str, *, learning_goal: str = "", environment_context: str = "", model_name: str | None = None) -> str`
- Produces: `generate_practice_lesson_to_db(node_id: int, project_topic: str, *, force: bool = False, learning_goal: str = "", environment_context: str = "") -> bool`

- [ ] Write failing tests for practice detection and task persistence.
- [ ] Run focused tests and verify failure.
- [ ] Implement detection, prompt, and DB persistence using `Task`.
- [ ] Make `generate_node_summary_to_db` invoke practice generation for practice-heavy nodes without failing the lecture if practice generation fails.
- [ ] Run focused tests and verify pass.

### Task 3: Workbench UI And Background Resources

**Files:**
- Modify: `learning_ext/pages/study_workbench.py`
- Test: `tests/test_pages.py`

**Interfaces:**
- Consumes: practice helpers from Task 2.
- Produces: `_gen_practice_lesson(node_id, project_id, force=True) -> tuple[str, str]`
- Produces: `_ensure_resources_background(node_id, project_id) -> str`

- [ ] Write failing page tests for the tab/button and background resource trigger.
- [ ] Run focused tests and verify failure.
- [ ] Add "实操课程" tab, manual generation button, and page outputs.
- [ ] Render saved practice task when selecting a course.
- [ ] Start daemon background resource fetch when no AI resources exist.
- [ ] Run focused tests and verify pass.

### Task 4: Verification

**Files:**
- Test: `tests/`

- [ ] Run focused tests for progress, path generator, and pages.
- [ ] Run full test suite.
- [ ] Restart local service and manually verify the workbench loads with the new tab.
