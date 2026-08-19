from fastapi.testclient import TestClient
from sqlmodel import Session
from pathlib import Path
from datetime import datetime
import json
import subprocess
import sys

from learning_ext.api import create_app
from learning_ext.db.models import KnowledgeNode, LearningProject


def _factory(engine):
    return lambda: Session(engine)


def test_health_spa_and_api_precedence(_db_engine, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<main>cockpit</main>", encoding="utf-8")
    app = create_app(session_factory=_factory(_db_engine), web_dist=dist)
    client = TestClient(app)

    assert client.get("/api/health").json() == {
        "status": "ok",
        "api_version": "1",
        "frontend": True,
    }
    assert "cockpit" in client.get("/courses/plan").text
    assert client.get("/api/missing").status_code == 404
    assert client.get("/legacy").status_code == 404
    assert client.get("/legacy/").status_code == 404
    assert client.get("/missing.js").status_code == 404


def test_production_factory_does_not_import_removed_ui():
    root = Path(__file__).resolve().parents[1]
    script = """
import json
import sys
import custom_app
from fastapi.testclient import TestClient

app = custom_app.create_production_app(runtime=object())
client = TestClient(app)
print(json.dumps({
    "health": client.get("/api/health").status_code,
    "legacy": client.get("/legacy").status_code,
    "gradio": "gradio" in sys.modules,
    "learning_app": "learning_ext.app" in sys.modules,
    "learning_pages": any(name == "learning_ext.pages" or name.startswith("learning_ext.pages.") for name in sys.modules),
}))
"""

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout.strip().splitlines()[-1])

    assert payload == {
        "health": 200,
        "legacy": 404,
        "gradio": False,
        "learning_app": False,
        "learning_pages": False,
    }


def test_missing_build_is_explicit(_db_engine, tmp_path):
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    response = client.get("/")

    assert response.status_code == 503
    assert response.json()["code"] == "FRONTEND_NOT_BUILT"


def test_host_and_origin_guards(_db_engine, tmp_path):
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    assert client.get("/api/health", headers={"host": "evil.example"}).status_code == 400
    blocked = client.post(
        "/api/chat/stream",
        json={"message": "hello"},
        headers={"origin": "https://evil.example"},
    )
    assert blocked.status_code == 403


def test_projects_are_owned_and_roadmap_has_stable_node_ids(_db_engine, session, tmp_path):
    owned = LearningProject(user_id="default", title="Owned", topic="x")
    foreign = LearningProject(user_id="other", title="Foreign", topic="y")
    session.add(owned)
    session.add(foreign)
    session.flush()
    session.add(KnowledgeNode(project_id=owned.id, code="2.10", title="ten"))
    session.add(KnowledgeNode(project_id=owned.id, code="2.2", title="two"))
    session.commit()
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    listing = client.get("/api/projects").json()["items"]
    assert [item["title"] for item in listing] == ["Owned"]
    assert client.get(f"/api/projects/{foreign.id}").status_code == 404
    nodes = client.get(f"/api/projects/{owned.id}/roadmap").json()["nodes"]
    assert [node["code"] for node in nodes] == ["2.2", "2.10"]
    assert all(node["node_id"] for node in nodes)


def test_home_uses_owned_selected_project_instead_of_newest(
    monkeypatch, _db_engine, session, tmp_path
):
    monkeypatch.setattr(
        "learning_ext.api.routes.core.config_status",
        lambda: {"configured": True},
    )
    selected = LearningProject(user_id="default", title="Selected", topic="selected")
    newest = LearningProject(user_id="default", title="Newest", topic="newest")
    foreign = LearningProject(user_id="other", title="Foreign", topic="foreign")
    session.add(selected)
    session.add(newest)
    session.add(foreign)
    session.flush()
    selected_node = KnowledgeNode(
        project_id=selected.id,
        code="1.1",
        title="Selected next",
    )
    newest_node = KnowledgeNode(
        project_id=newest.id,
        code="1.1",
        title="Newest next",
    )
    session.add(selected_node)
    session.add(newest_node)
    session.commit()
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    response = client.get("/api/home", params={"project_id": selected.id})

    assert response.status_code == 200
    assert response.json()["current_project"]["id"] == selected.id
    assert response.json()["next_node"]["id"] == selected_node.id
    assert client.get("/api/home", params={"project_id": foreign.id}).status_code == 404


def test_home_does_not_accept_client_user_identity(
    monkeypatch, _db_engine, session, tmp_path
):
    monkeypatch.setattr(
        "learning_ext.api.routes.core.config_status",
        lambda: {"configured": True},
    )
    owned = LearningProject(user_id="default", title="Owned", topic="owned")
    foreign = LearningProject(user_id="other", title="Foreign", topic="foreign")
    session.add(owned)
    session.add(foreign)
    session.commit()
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    response = client.get("/api/home", params={"user_id": "other"})

    assert response.status_code == 200
    assert response.json()["current_project"]["id"] == owned.id


def test_projects_and_default_home_use_a_deterministic_tie_breaker(
    monkeypatch, _db_engine, session, tmp_path
):
    monkeypatch.setattr(
        "learning_ext.api.routes.core.config_status",
        lambda: {"configured": True},
    )
    same_time = datetime(2026, 8, 19, 8, 0, 0)
    first = LearningProject(
        user_id="default", title="First", topic="first", updated_at=same_time
    )
    second = LearningProject(
        user_id="default", title="Second", topic="second", updated_at=same_time
    )
    session.add(first)
    session.add(second)
    session.commit()
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    listing = client.get("/api/projects").json()["items"]
    home = client.get("/api/home").json()

    assert [item["id"] for item in listing] == [second.id, first.id]
    assert home["current_project"]["id"] == second.id


def test_roadmap_stream_sends_progress_then_complete_result(monkeypatch, _db_engine, tmp_path):
    monkeypatch.setattr(
        "learning_ext.api.routes.core.generate_roadmap",
        lambda *args, **kwargs: {
            "summary": "路线",
            "stages": [{"name": "基础", "stage": "base", "goal": ""}],
            "nodes": [{"code": "1.1", "title": "开始", "stage": "base", "prerequisites": []}],
        },
    )
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    response = client.post(
        "/api/projects/generate/stream",
        json={"topic": "主题", "save": False},
    )

    events = [line.removeprefix("event: ") for line in response.text.splitlines() if line.startswith("event: ")]
    assert events == ["start", "progress", "progress", "result", "done"]
    assert "```" not in response.text


def test_fifty_node_roadmap_keeps_numeric_order_and_ids(_db_engine, session, tmp_path):
    project = LearningProject(user_id="default", title="50 节路线", topic="large")
    session.add(project)
    session.flush()
    for index in range(50, 0, -1):
        session.add(
            KnowledgeNode(
                project_id=project.id,
                code=f"2.{index}",
                title=f"节点 {index}",
                stage="strengthen",
            )
        )
    session.commit()
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    nodes = client.get(f"/api/projects/{project.id}/roadmap").json()["nodes"]

    assert len(nodes) == 50
    assert [node["code"] for node in nodes[:3]] == ["2.1", "2.2", "2.3"]
    assert nodes[-1]["code"] == "2.50"
    assert len({node["node_id"] for node in nodes}) == 50


def test_validation_rejects_user_id(_db_engine, tmp_path):
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    response = client.post(
        "/api/projects/generate/stream",
        json={"topic": "主题", "user_id": "other"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_FAILED"


def test_chat_stream_uses_runtime_and_emits_structured_citation(_db_engine, tmp_path):
    class Runtime:
        def stream_chat(self, **kwargs):
            assert kwargs["user_id"] == "default"
            assert kwargs["file_ids"] is None
            yield {"type": "delta", "data": {"text": "答案"}}
            yield {
                "type": "citation",
                "data": {
                    "citation_id": "doc-1",
                    "file_id": "file-1",
                    "title": "资料",
                    "page": "3",
                    "snippet": "原文",
                },
            }

    client = TestClient(
        create_app(runtime=Runtime(), session_factory=_factory(_db_engine), web_dist=tmp_path)
    )

    response = client.post("/api/chat/stream", json={"message": "问题"})

    events = [line.removeprefix("event: ") for line in response.text.splitlines() if line.startswith("event: ")]
    assert events == ["start", "delta", "citation", "result", "done"]
    assert '"file_id":"file-1"' in response.text


def test_library_upload_passes_real_temp_file_to_runtime_and_cleans_it(_db_engine, tmp_path):
    observed: dict[str, object] = {}

    class Runtime:
        def stream_index_file(self, **kwargs):
            path = kwargs["file_path"]
            observed["path"] = path
            observed["content"] = Path(path).read_text(encoding="utf-8")
            yield {
                "type": "progress",
                "data": {"phase": "embedding", "message": "正在处理资料", "current": 1, "total": 1},
            }
            yield {
                "type": "result",
                "data": {"kind": "library-index", "payload": {"file_id": "file-1"}},
            }

    client = TestClient(
        create_app(runtime=Runtime(), session_factory=_factory(_db_engine), web_dist=tmp_path)
    )

    response = client.post(
        "/api/library/index/stream",
        files={"file": ("lesson.txt", "真实文件内容", "text/plain")},
    )

    assert response.status_code == 200
    assert [line.removeprefix("event: ") for line in response.text.splitlines() if line.startswith("event: ")] == [
        "start",
        "progress",
        "result",
        "done",
    ]
    assert observed["content"] == "真实文件内容"
    assert not Path(observed["path"]).exists()


def test_node_content_stream_persists_generated_lesson(monkeypatch, _db_engine, session, tmp_path):
    project = LearningProject(user_id="default", title="课程", topic="主题", goal="掌握")
    session.add(project)
    session.flush()
    node = KnowledgeNode(project_id=project.id, code="1.1", title="第一节", description="简述")
    session.add(node)
    session.commit()
    monkeypatch.setattr(
        "learning_ext.api.routes.core.generate_node_summary",
        lambda *args, **kwargs: "## 完整教学内容\n\n" + "真实内容" * 80,
    )
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    response = client.post(f"/api/nodes/{node.id}/content/stream")

    assert response.status_code == 200
    assert [line.removeprefix("event: ") for line in response.text.splitlines() if line.startswith("event: ")] == [
        "start",
        "progress",
        "progress",
        "result",
        "done",
    ]
    assert "完整教学内容" in client.get(f"/api/nodes/{node.id}").json()["content"]


def test_node_resource_stream_generates_and_persists_owned_resources(
    monkeypatch, _db_engine, session, tmp_path
):
    project = LearningProject(user_id="default", title="课程", topic="主题")
    session.add(project)
    session.flush()
    node = KnowledgeNode(project_id=project.id, code="1.1", title="第一节")
    session.add(node)
    session.commit()
    monkeypatch.setattr(
        "learning_ext.api.routes.core.generate_resources",
        lambda *_args, **_kwargs: [
            {
                "title": "官方文档",
                "url": "https://example.com/docs",
                "rtype": "html",
                "description": "对应本节概念",
            }
        ],
    )
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    response = client.post(f"/api/nodes/{node.id}/resources/stream")
    resources = client.get(f"/api/nodes/{node.id}/resources").json()["items"]

    assert response.status_code == 200
    assert [line.removeprefix("event: ") for line in response.text.splitlines() if line.startswith("event: ")] == [
        "start",
        "progress",
        "progress",
        "result",
        "done",
    ]
    assert resources == [
        {
            "id": resources[0]["id"],
            "title": "官方文档",
            "url": "https://example.com/docs",
            "type": "html",
            "description": "对应本节概念",
        }
    ]


def test_node_assistant_chat_injects_owned_course_context(
    _db_engine, session, tmp_path
):
    project = LearningProject(user_id="default", title="Python 课程", topic="Python")
    session.add(project)
    session.flush()
    node = KnowledgeNode(
        project_id=project.id,
        code="2.3",
        title="生成器",
        description="yield 会暂停函数并保留状态。",
    )
    session.add(node)
    session.commit()
    observed: dict[str, str] = {}

    class Runtime:
        def stream_chat(self, **kwargs):
            observed["message"] = kwargs["message"]
            yield {"type": "delta", "data": {"text": "结合本节回答"}}

    client = TestClient(
        create_app(runtime=Runtime(), session_factory=_factory(_db_engine), web_dist=tmp_path)
    )

    response = client.post(
        "/api/chat/stream",
        json={
            "message": "为什么需要 yield？",
            "project_id": project.id,
            "node_id": node.id,
            "file_ids": [],
        },
    )

    assert response.status_code == 200
    assert "【项目】Python 课程" in observed["message"]
    assert "【当前节点】2.3 生成器" in observed["message"]
    assert "yield 会暂停函数" in observed["message"]
    assert "【学习者问题】为什么需要 yield？" in observed["message"]


def test_node_assistant_rejects_mismatched_project_context(
    _db_engine, session, tmp_path
):
    owned = LearningProject(user_id="default", title="课程 A", topic="A")
    other = LearningProject(user_id="default", title="课程 B", topic="B")
    session.add(owned)
    session.add(other)
    session.flush()
    node = KnowledgeNode(project_id=owned.id, code="1.1", title="第一节")
    session.add(node)
    session.commit()
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    response = client.post(
        "/api/chat/stream",
        json={"message": "问题", "project_id": other.id, "node_id": node.id},
    )

    assert response.status_code == 404


def test_project_export_and_import_are_owned(_db_engine, session, tmp_path):
    project = LearningProject(
        user_id="default",
        title="可导出课程",
        topic="主题",
        roadmap_json='{"summary":"路线","stages":[{"stage":"base","name":"基础"}],"nodes":[{"code":"1.1","title":"开始","stage":"base"}]}',
    )
    session.add(project)
    session.flush()
    session.add(KnowledgeNode(project_id=project.id, code="1.1", title="开始", stage="base"))
    session.commit()
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    exported = client.get(f"/api/projects/{project.id}/export")
    imported = client.post("/api/projects/import", json={"payload": exported.text})

    assert exported.status_code == 200
    assert "attachment" in exported.headers["content-disposition"]
    assert imported.status_code == 200
    assert imported.json()["title"] == "可导出课程"


def test_chat_conversation_persists_messages_and_selected_sources(_db_engine, tmp_path):
    from ktem.db.models import Conversation

    Conversation.metadata.create_all(_db_engine)

    class Runtime:
        def stream_chat(self, **kwargs):
            assert kwargs["user_id"] == "default"
            assert kwargs["file_ids"] == ["file-1"]
            yield {"type": "delta", "data": {"text": "持久化回答"}}

    client = TestClient(
        create_app(runtime=Runtime(), session_factory=_factory(_db_engine), web_dist=tmp_path)
    )
    created = client.post("/api/chat/conversations", json={"title": "学习记录"}).json()

    streamed = client.post(
        "/api/chat/stream",
        json={"message": "问题", "conversation_id": created["id"], "file_ids": ["file-1"]},
    )
    detail = client.get(f"/api/chat/conversations/{created['id']}").json()

    assert streamed.status_code == 200
    assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][1]["content"] == "持久化回答"
    assert detail["file_ids"] == ["file-1"]
    renamed = client.patch(
        f"/api/chat/conversations/{created['id']}",
        json={"title": "重命名后的学习记录"},
    )
    assert renamed.json()["title"] == "重命名后的学习记录"


def test_library_group_routes_delegate_with_server_user(_db_engine, tmp_path):
    calls: list[tuple] = []

    class Runtime:
        def list_groups(self, user_id, index_id):
            calls.append(("list", user_id, index_id))
            return [{"id": "group-1", "index_id": "1", "name": "核心", "file_ids": ["file-1"]}]

        def create_group(self, user_id, index_id, name, file_ids):
            calls.append(("create", user_id, index_id, name, file_ids))
            return {"id": "group-1", "index_id": index_id, "name": name, "file_ids": file_ids}

        def update_group(self, user_id, group_id, *, name, file_ids):
            calls.append(("update", user_id, group_id, name, file_ids))
            return {"id": group_id, "index_id": "1", "name": name or "核心", "file_ids": file_ids or []}

        def delete_group(self, user_id, group_id):
            calls.append(("delete", user_id, group_id))
            return True

    client = TestClient(
        create_app(runtime=Runtime(), session_factory=_factory(_db_engine), web_dist=tmp_path)
    )

    assert client.get("/api/library/groups?index_id=1").status_code == 200
    assert client.post(
        "/api/library/groups",
        json={"index_id": "1", "name": "核心", "file_ids": ["file-1"]},
    ).status_code == 200
    assert client.patch(
        "/api/library/groups/group-1",
        json={"name": "必读", "file_ids": ["file-1"]},
    ).status_code == 200
    assert client.delete("/api/library/groups/group-1").status_code == 200
    assert all(call[1] == "default" for call in calls)


def test_config_runtime_failure_has_stable_non_secret_error(monkeypatch, _db_engine, tmp_path):
    from learning_ext.config import RuntimeConfigApplyError

    monkeypatch.setattr(
        "learning_ext.api.routes.core.save_config",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeConfigApplyError("secret-key")),
    )
    client = TestClient(create_app(session_factory=_factory(_db_engine), web_dist=tmp_path))

    response = client.put(
        "/api/config",
        json={
            "provider": "custom",
            "base_url": "https://api.example.com/v1",
            "model": "chat-model",
            "embeddingModel": "embedding-model",
            "apiKey": "sentinel-secret",
        },
    )

    assert response.status_code == 500
    assert response.json()["code"] == "CONFIG_APPLY_FAILED"
    assert "sentinel-secret" not in response.text
