"""Page 层业务逻辑测试 (工作台重构后的版本)。

工作台改为 @gr.render 动态按钮, 这里测可独立测试的业务逻辑。
"""

from __future__ import annotations

import json
import inspect
from pathlib import Path
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def path_page():
    from learning_ext.pages.path_generator import PathGeneratorPage

    app_mock = MagicMock()
    app_mock.f_user_management = False
    return PathGeneratorPage(app_mock)


class TestPathGeneratorPageLogic:
    def test_generate_empty_topic(self, path_page):
        _, _, status = path_page._handle_generate("", "", "", 10)
        assert "请输入选题" in status

    def test_generate_success(self, path_page, mock_llm):
        md, js, status = path_page._handle_generate("学Python", "", "", 8)
        assert "✅" in status
        assert "1.1" in md
        assert "nodes" in json.loads(js)

    def test_generate_llm_failure(self, path_page, monkeypatch):
        import learning_ext.path_generator.service as svc

        monkeypatch.setattr(
            svc,
            "chat_json",
            lambda *a, **k: (_ for _ in ()).throw(RuntimeError("API挂了")),
        )
        _, _, status = path_page._handle_generate("test", "", "", 5)
        assert "❌" in status

    def test_refine_empty_instruction(self, path_page):
        _, _, status = path_page._handle_refine('{"nodes":[]}', "")
        assert "请输入调整意见" in status

    def test_roadmap_to_markdown_empty(self, path_page):
        assert "空" in path_page._roadmap_to_markdown({})

    def test_refresh_projects_returns_list(self, path_page):
        assert isinstance(path_page._refresh_projects(), list)


class TestSaveWithSetup:
    def test_save_empty_roadmap(self, path_page):
        results = list(path_page._handle_save_with_setup("", "", "", 10, "{}"))
        assert "请先生成路线" in results[0][2]

    def test_save_invalid_json(self, path_page):
        results = list(path_page._handle_save_with_setup("t", "", "", 5, "not json{"))
        assert "解析失败" in results[0][2] or "❌" in results[0][2]

    def test_save_pre_gen_first_3(self, path_page, session, mock_llm):
        roadmap = {
            "summary": "x",
            "stages": [],
            "nodes": [
                {
                    "code": f"1.{i}",
                    "title": f"节{i}",
                    "stage": "base",
                    "est_hours": 1,
                    "difficulty": 1,
                    "prerequisites": [],
                }
                for i in range(1, 6)
            ],
        }
        results = list(
            path_page._handle_save_with_setup("t", "", "", 5, json.dumps(roadmap))
        )
        assert results[-1][0] is not None
        assert "准备就绪" in results[-1][1]


class TestLearningAppEventRegistration:
    def test_learning_app_does_not_use_inert_word_lookup_injection_paths(self):
        from learning_ext.app import LearningApp

        source = inspect.getsource(LearningApp.__init__) + inspect.getsource(
            LearningApp.make
        )

        assert "_inject_word_lookup_js" not in source
        assert "WORD_LOOKUP_HEAD_SCRIPT" not in source

    def test_learning_app_does_not_register_page_events_directly(self):
        from learning_ext.app import LearningApp

        app = object.__new__(LearningApp)
        calls = []

        class PageStub:
            def on_register_events(self):
                calls.append("registered")

        app.learning_workbench_page = PageStub()

        app.on_register_events()

        assert calls == []


class TestStudyWorkbenchPageLogic:
    def _make_page(self, session, monkeypatch):
        import learning_ext.pages.study_workbench as wb

        monkeypatch.setattr(wb, "engine", session.get_bind())
        app_mock = MagicMock()
        app_mock.f_user_management = False
        return wb, wb.StudyWorkbenchPage(app_mock)

    def test_workbench_css_keeps_center_column_content_in_flow(self):
        import learning_ext.pages.study_workbench as wb

        css = " ".join(wb.WORKBENCH_CSS.split())

        assert "#le-workbench-row" in css
        assert "flex-wrap: nowrap" in css
        assert "#le-center-col > *" in css
        assert "width: 100%" in css
        assert "min-width: 0" in css

    def test_word_lookup_js_is_event_handler_with_confirmation_popup(self):
        import learning_ext.pages.study_workbench as wb

        js = wb.WORD_LOOKUP_JS

        assert "<script" not in js.lower()
        assert "window.__leInstallWordLookup" in js
        assert "function(...args)" in js
        assert "return args" in js

    def test_workbench_does_not_use_inert_html_or_head_script_installers(self):
        import learning_ext.pages.study_workbench as wb

        source = inspect.getsource(wb)

        assert "WORD_LOOKUP_INSTALLER_HTML" not in source
        assert "WORD_LOOKUP_HEAD_SCRIPT" not in source

    def test_selected_term_trigger_is_visually_hidden_but_event_capable(self):
        import learning_ext.pages.study_workbench as wb

        css = " ".join(wb.WORKBENCH_CSS.split())

        assert "#le-selected-term" in css
        assert "position: absolute" in css
        assert "opacity: 0" in css

    def test_selected_term_change_does_not_use_word_lookup_js_preprocessor(self):
        import learning_ext.pages.study_workbench as wb

        source = inspect.getsource(wb.StudyWorkbenchPage.on_register_events)
        start = source.index("self.selected_term.change(")
        end = source.index("self.term_explain_btn.click(", start)
        selected_term_change = source[start:end]

        assert "js=WORD_LOOKUP_JS" not in selected_term_change

    def test_workbench_auto_init_installs_word_lookup_js(self):
        import learning_ext.pages.study_workbench as wb

        source = inspect.getsource(wb.StudyWorkbenchPage.on_register_events)

        assert "self._app.app.load" in source
        assert "js=WORD_LOOKUP_JS" in source

    def test_word_lookup_static_asset_contains_popup_installer(self):
        asset = Path("learning_ext/assets/word_lookup.js")

        assert asset.exists()
        js = asset.read_text(encoding="utf-8")
        assert "window.__leWordLookupInstalled" in js
        assert "是否需要名词解释" in js
        assert "解释这个名词" in js
        assert "le-selected-term" in js
        assert "le-word-lookup-ready" in js

    def test_custom_app_serves_word_lookup_asset_in_initial_template(self):
        source = Path("custom_app.py").read_text(encoding="utf-8")

        assert "_patch_gradio_template_for_learning_assets" in source
        assert "learning_ext/assets/word_lookup.js" in source
        assert "learning_ext/assets" in source
        assert "word_lookup_js = Path(_HERE, script_path).read_text" in source
        assert "<script>\\n{word_lookup_js}\\n</script>" in source

    def test_selecting_short_description_generates_course_content(
        self, session, sample_project, monkeypatch
    ):
        from sqlmodel import Session, select

        from learning_ext.db.models import KnowledgeNode

        wb, page = self._make_page(session, monkeypatch)
        node = session.exec(
            select(KnowledgeNode).where(KnowledgeNode.project_id == sample_project.id)
        ).first()
        node.description = "这是路线里的短说明，不是课程正文。"
        session.add(node)
        session.commit()

        generated_content = (
            "## 本节导览\n"
            + "这里是完整课程正文，可以用于学习、划词解释和追问。"
            * 20
            + "\n\n## 自测练习\n- 解释核心概念。"
        )
        called = {}

        def fake_generate_node_summary_to_db(node_id, project_topic):
            called["args"] = (node_id, project_topic)
            with Session(session.get_bind()) as s:
                fresh = s.get(KnowledgeNode, node_id)
                fresh.description = generated_content
                s.add(fresh)
                s.commit()
            return True

        monkeypatch.setattr(
            wb, "generate_node_summary_to_db", fake_generate_node_summary_to_db
        )

        current_node_id, _, guide, *_ = page._on_node_select(str(node.id))

        assert current_node_id == node.id
        assert called["args"] == (node.id, sample_project.topic)
        assert "完整课程正文" in guide
        assert "路线里的短说明" not in guide

    def test_status_update_keeps_selected_course_visible(
        self, session, sample_project, monkeypatch
    ):
        from sqlmodel import select

        from learning_ext.db.models import KnowledgeNode
        from learning_ext.progress.study import STATUS_SKIPPED

        _, page = self._make_page(session, monkeypatch)
        node = session.exec(
            select(KnowledgeNode).where(KnowledgeNode.project_id == sample_project.id)
        ).first()

        _, _, course_update = page._set_status(str(node.id), STATUS_SKIPPED)

        assert course_update["value"] == str(node.id)

    def test_course_stage_separator_does_not_clear_current_content(
        self, session, monkeypatch
    ):
        _, page = self._make_page(session, monkeypatch)

        result = page._on_course_change("__stage__")

        assert len(result) == 7
        assert all(item["__type__"] == "update" for item in result)

    def test_regen_current_node_forces_existing_content_regeneration(
        self, session, sample_project, monkeypatch
    ):
        from sqlmodel import Session, select

        from learning_ext.db.models import KnowledgeNode

        wb, page = self._make_page(session, monkeypatch)
        node = session.exec(select(KnowledgeNode)).first()
        node.description = (
            "## 已有导览\n"
            + "这是已有的完整课程正文。" * 60
            + "\n\n## 已有练习\n- 复习已有内容。"
        )
        session.add(node)
        session.commit()

        generated_content = (
            "## 新导览\n"
            + "这是重新生成后的完整课程正文。" * 60
            + "\n\n## 新练习\n- 复习新内容。"
        )
        called = {}

        def fake_generate_node_summary_to_db(node_id, project_topic, *, force=False):
            called["force"] = force
            with Session(session.get_bind()) as s:
                fresh = s.get(KnowledgeNode, node_id)
                fresh.description = generated_content
                s.add(fresh)
                s.commit()
            return True

        monkeypatch.setattr(
            wb, "generate_node_summary_to_db", fake_generate_node_summary_to_db
        )

        _, _, guide = page._regen_current_node(str(node.id), str(sample_project.id))

        assert called["force"] is True
        assert "重新生成后的完整课程正文" in guide

    def test_auto_term_lookup_uses_current_node_context(
        self, session, sample_project, monkeypatch
    ):
        from sqlmodel import select

        from learning_ext.db.models import KnowledgeNode

        _, page = self._make_page(session, monkeypatch)
        node = session.exec(select(KnowledgeNode)).first()
        captured = {}

        def fake_do_explain(term, node_id=None):
            captured["term"] = term
            captured["node_id"] = node_id
            return "解释结果"

        monkeypatch.setattr(page, "_do_explain", fake_do_explain)

        result = page._on_term_selected("  概念  ", str(node.id))

        assert result == "解释结果"
        assert captured == {"term": "概念", "node_id": str(node.id)}


class TestStudyWorkbenchService:
    def test_generate_summary_skips_existing(self, session, sample_project, mock_llm):
        from sqlmodel import select
        from learning_ext.db.models import KnowledgeNode
        from learning_ext.progress.study import generate_node_summary_to_db

        node = session.exec(select(KnowledgeNode)).first()
        node.description = "已有内容" * 20
        session.add(node)
        session.commit()
        assert generate_node_summary_to_db(node.id, sample_project.topic) is True

    def test_generate_summary_nonexistent(self, session):
        from learning_ext.progress.study import generate_node_summary_to_db

        assert generate_node_summary_to_db(99999, "x") is False
