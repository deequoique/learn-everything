"""学习推进 service 测试：状态机、依赖解锁、进度统计。"""

from __future__ import annotations

import pytest
from sqlmodel import select

from learning_ext.db.models import KnowledgeNode, Task
from learning_ext.progress.study import (
    STATUS_LEARNING,
    STATUS_MASTERED,
    STATUS_PENDING,
    STATUS_SKIPPED,
    STATUS_WEAK,
    generate_env_checklist,
    get_next_learnable_nodes,
    get_nodes_without_content,
    get_project_progress,
    save_env_tasks,
    set_node_status,
)


def _get_node(session, project_id, code):
    return session.exec(
        select(KnowledgeNode)
        .where(KnowledgeNode.project_id == project_id)
        .where(KnowledgeNode.code == code)
    ).first()


class TestSetNodeStatus:
    def test_valid_status_transitions(self, session, sample_project):
        n = _get_node(session, sample_project.id, "1.1")
        for status in [
            STATUS_LEARNING,
            STATUS_MASTERED,
            STATUS_PENDING,
            STATUS_SKIPPED,
            STATUS_WEAK,
        ]:
            updated = set_node_status(session, n.id, status)
            assert updated.status == status

    def test_invalid_status_raises(self, session, sample_project):
        n = _get_node(session, sample_project.id, "1.1")
        with pytest.raises(ValueError, match="非法状态"):
            set_node_status(session, n.id, "invalid_status")

    def test_nonexistent_node_raises(self, session):
        with pytest.raises(ValueError, match="不存在"):
            set_node_status(session, 99999, STATUS_LEARNING)


class TestGetNextLearnableNodes:
    def test_initial_only_root_unlocked(self, session, sample_project):
        """初始状态: 只有 1.1 (无前置依赖) 可学, 1.2 和 2.1 应锁定。"""
        learnable = get_next_learnable_nodes(session, sample_project.id)
        codes = [n.code for n in learnable]
        assert "1.1" in codes
        assert "1.2" not in codes  # 依赖 1.1
        assert "2.1" not in codes  # 依赖 1.2

    def test_unlocks_after_mastered(self, session, sample_project):
        """掌握 1.1 后, 1.2 解锁。"""
        n11 = _get_node(session, sample_project.id, "1.1")
        set_node_status(session, n11.id, STATUS_MASTERED)

        learnable = get_next_learnable_nodes(session, sample_project.id)
        codes = [n.code for n in learnable]
        assert "1.2" in codes
        assert "2.1" not in codes  # 仍依赖 1.2

    def test_unlocks_after_skip(self, session, sample_project):
        """跳过 1.1 也应解锁 1.2。"""
        n11 = _get_node(session, sample_project.id, "1.1")
        set_node_status(session, n11.id, STATUS_SKIPPED)
        learnable = get_next_learnable_nodes(session, sample_project.id)
        assert "1.2" in [n.code for n in learnable]

    def test_learning_node_always_shown(self, session, sample_project):
        """学习中的节点始终在可学列表 (即使用户改了项目)。"""
        n11 = _get_node(session, sample_project.id, "1.1")
        set_node_status(session, n11.id, STATUS_LEARNING)
        learnable = get_next_learnable_nodes(session, sample_project.id)
        assert "1.1" in [n.code for n in learnable]

    def test_limit_respected(self, session, sample_project):
        learnable = get_next_learnable_nodes(session, sample_project.id, limit=1)
        assert len(learnable) <= 1

    def test_empty_project(self, session):
        from learning_ext.db.models import LearningProject

        p = LearningProject(
            user_id="default",
            topic="empty",
            background="",
            goal="",
            weekly_hours=1,
            roadmap_json="{}",
            status="active",
        )
        session.add(p)
        session.commit()
        learnable = get_next_learnable_nodes(session, p.id)
        assert learnable == []

    def test_chain_unblock(self, session, sample_project):
        """连续掌握: 1.1 -> 解锁 1.2 -> 掌握 1.2 -> 解锁 2.1。"""
        for code in ["1.1", "1.2"]:
            n = _get_node(session, sample_project.id, code)
            set_node_status(session, n.id, STATUS_MASTERED)
        learnable = get_next_learnable_nodes(session, sample_project.id)
        assert "2.1" in [n.code for n in learnable]


class TestGetProjectProgress:
    def test_initial_progress(self, session, sample_project):
        prog = get_project_progress(session, sample_project.id)
        assert prog["total"] == 3
        assert prog["done"] == 0
        assert prog["pending"] == 3
        assert prog["learning"] == 0
        assert prog["pct"] == 0.0

    def test_progress_after_mastered(self, session, sample_project):
        n = _get_node(session, sample_project.id, "1.1")
        set_node_status(session, n.id, STATUS_MASTERED)
        prog = get_project_progress(session, sample_project.id)
        assert prog["done"] == 1
        assert prog["pct"] == pytest.approx(33.3, abs=0.1)

    def test_empty_project(self, session):
        from learning_ext.db.models import LearningProject

        p = LearningProject(
            user_id="default",
            topic="e",
            background="",
            goal="",
            weekly_hours=1,
            roadmap_json="{}",
            status="active",
        )
        session.add(p)
        session.commit()
        prog = get_project_progress(session, p.id)
        assert prog["total"] == 0
        assert prog["pct"] == 0.0


class TestContentGenerationQueue:
    def test_get_nodes_without_content_uses_validity_check(
        self, session, sample_project
    ):
        nodes = session.exec(
            select(KnowledgeNode)
            .where(KnowledgeNode.project_id == sample_project.id)
            .order_by(KnowledgeNode.code)
        ).all()
        nodes[0].description = "这是模拟的 LLM 回复。" * 12
        nodes[1].description = "路线里的短说明"
        nodes[2].description = (
            "## 完整导览\n"
            + "这是可以直接学习的完整课程正文。" * 60
            + "\n\n## 自测练习\n- 解释关键概念。"
        )
        session.add_all(nodes)
        session.commit()

        pending = get_nodes_without_content(session, sample_project.id, limit=10)

        assert [n.id for n in pending] == [nodes[0].id, nodes[1].id]

    def test_generate_summary_force_regenerates_existing_content(
        self, session, sample_project, monkeypatch
    ):
        import ktem.db.engine as db_engine
        import learning_ext.progress.study as study

        monkeypatch.setattr(db_engine, "engine", session.get_bind())
        node = session.exec(select(KnowledgeNode)).first()
        node.description = (
            "## 已有导览\n"
            + "这是已有的完整课程正文。" * 60
            + "\n\n## 已有练习\n- 复习已有内容。"
        )
        session.add(node)
        session.commit()

        monkeypatch.setattr(
            study,
            "generate_node_summary",
            lambda node, topic: (
                "## 新导览\n"
                + "这是强制重新生成后的完整课程正文。" * 60
                + "\n\n## 新练习\n- 复习新内容。"
            ),
        )

        assert (
            study.generate_node_summary_to_db(
                node.id, sample_project.topic, force=True
            )
            is True
        )
        session.refresh(node)
        assert "强制重新生成后" in node.description

    def test_regenerate_all_content_passes_force_to_background(
        self, session, sample_project, monkeypatch
    ):
        import ktem.db.engine as db_engine
        import learning_ext.progress.study as study

        monkeypatch.setattr(db_engine, "engine", session.get_bind())
        nodes = session.exec(
            select(KnowledgeNode)
            .where(KnowledgeNode.project_id == sample_project.id)
            .order_by(KnowledgeNode.code)
        ).all()
        for node in nodes:
            node.description = (
                "## 已有导览\n"
                + f"{node.title} 已有完整课程正文。" * 60
                + "\n\n## 已有练习\n- 复习已有内容。"
            )
            session.add(node)
        session.commit()

        captured = {}

        def fake_generate_summaries_background(
            project_id, project_topic, node_ids, max_workers=3, *, force=False
        ):
            captured["force"] = force
            captured["node_ids"] = node_ids

        monkeypatch.setattr(
            study, "generate_summaries_background", fake_generate_summaries_background
        )

        result = study.regenerate_all_content(project_id=sample_project.id, force=True)

        assert result["queued"] == len(nodes)
        assert captured["force"] is True
        assert captured["node_ids"] == [n.id for n in nodes]


class TestEnvChecklist:
    def test_save_env_task(self, session, sample_project):
        tasks = save_env_tasks(session, sample_project.id, "# 测试清单\n- item")
        assert len(tasks) == 1
        assert tasks[0].task_type == "env"
        assert tasks[0].project_id == sample_project.id

    def test_save_env_task_replaces_old(self, session, sample_project):
        save_env_tasks(session, sample_project.id, "v1")
        save_env_tasks(session, sample_project.id, "v2")
        tasks = session.exec(
            select(Task)
            .where(Task.project_id == sample_project.id)
            .where(Task.task_type == "env")
        ).all()
        assert len(tasks) == 1
        assert "v2" in tasks[0].description

    def test_generate_env_checklist(self, mock_llm):
        md = generate_env_checklist("学Python", "新手")
        assert isinstance(md, str)
        assert len(md) > 0
