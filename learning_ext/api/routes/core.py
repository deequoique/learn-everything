from __future__ import annotations

import threading
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, Response
from sqlmodel import Session, select

from learning_ext.api.dependencies import (
    CURRENT_USER_ID,
    get_session,
    require_card,
    require_node,
    require_project,
)
from learning_ext.api.errors import ApiError, bad_request
from learning_ext.api.schemas import (
    ChatRequest,
    ConfigRequest,
    ConversationCreateRequest,
    ConversationUpdateRequest,
    LibraryGroupCreateRequest,
    LibraryGroupUpdateRequest,
    LibraryIndexRequest,
    NodeStatusRequest,
    NoteRequest,
    ProjectAuditRequest,
    ProjectGenerateRequest,
    ProjectImportRequest,
    ProjectRefineRequest,
    ReviewRequest,
)
from learning_ext.api.streaming import StreamEvent, stream_response
from learning_ext.config import (
    ApiKeyRequired,
    RuntimeConfigApplyError,
    config_status,
    get_saved_api_key,
    save_config,
)
from learning_ext.dashboard.service import build_dashboard_data
from learning_ext.db.models import KnowledgeNode, LearningProject
from learning_ext.fsrs_review.service import get_due_cards, get_review_stats, review_card
from learning_ext.kotaemon_adapter.library import FileCleanupIncomplete
from learning_ext.notes.service import (
    generate_resources,
    get_note,
    get_resources,
    save_note,
    save_resources_to_db,
)
from learning_ext.path_generator.service import (
    audit_existing_roadmap,
    export_roadmap_bundle,
    generate_roadmap,
    import_roadmap_bundle,
    load_roadmap,
    refine_roadmap,
    replace_project_roadmap,
    save_roadmap,
)
from learning_ext.progress.study import (
    _save_practice_task,
    generate_node_summary,
    generate_practice_lesson,
    get_next_learnable_nodes,
    get_practice_task,
    get_project_progress,
    is_content_valid,
    set_node_status,
)
from learning_ext.project_ops import delete_project

router = APIRouter(prefix="/api")
DB = Annotated[Session, Depends(get_session)]
_ACTIVE_CONVERSATIONS: set[str] = set()
_ACTIVE_INDICES: set[str] = set()
_ACTIVE_PROJECTS: set[int] = set()
_ACTIVE_NODES: set[int] = set()
_STREAM_LOCK = threading.Lock()
_ALLOWED_UPLOAD_SUFFIXES = {".pdf", ".md", ".txt", ".docx", ".pptx"}
_MAX_UPLOAD_BYTES = 200 * 1024 * 1024


def _acquire_stream_slot(active: set, key: Any, message: str) -> None:
    with _STREAM_LOCK:
        if key in active:
            raise ApiError(409, "RESOURCE_BUSY", message)
        active.add(key)


def _release_stream_slot(active: set, key: Any) -> None:
    with _STREAM_LOCK:
        active.discard(key)


def _project_data(project: LearningProject, session: Session) -> dict[str, Any]:
    progress = get_project_progress(session, project.id)
    return {
        "id": project.id,
        "title": project.title,
        "topic": project.topic,
        "goal": project.goal,
        "weekly_hours": project.weekly_hours,
        "status": project.status,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat(),
        "progress": progress,
        "progress_ratio": progress["pct"] / 100,
        "completed_count": progress["done"],
        "node_count": progress["total"],
    }


def _node_data(node: KnowledgeNode) -> dict[str, Any]:
    return {
        "id": node.id,
        "node_id": node.id,
        "project_id": node.project_id,
        "code": node.code,
        "title": node.title,
        "description": node.description,
        "content": node.description,
        "stage": node.stage,
        "stage_id": node.stage,
        "stage_title": node.stage,
        "est_hours": node.est_hours,
        "estimated_minutes": max(1, round(node.est_hours * 60)),
        "difficulty": node.difficulty,
        "mastery": node.mastery,
        "status": node.status,
    }


def _resource_data(row: Any) -> dict[str, Any]:
    return {
        "id": row.id,
        "title": row.title,
        "url": row.url,
        "type": row.rtype,
        "description": row.description,
    }


@router.get("/health")
def health(request: Request) -> dict:
    return {
        "status": "ok",
        "api_version": "1",
        "frontend": bool(request.app.state.frontend_available),
    }


@router.get("/home")
def home(session: DB, project_id: int | None = None) -> dict:
    configured = config_status()["configured"]
    selected_project = require_project(session, project_id) if project_id is not None else None
    projects = list(
        session.exec(
            select(LearningProject)
            .where(LearningProject.user_id == CURRENT_USER_ID)
            .order_by(LearningProject.updated_at.desc(), LearningProject.id.desc())
        ).all()
    )
    review = get_review_stats(session, CURRENT_USER_ID)
    if not configured:
        return {"state": "setup", "configured": False, "action": {"label": "连接 AI", "href": "/settings"}, "due_reviews": review["due_count"]}
    if not projects:
        return {"state": "empty", "configured": True, "action": {"label": "创建学习计划", "href": "/courses/plan"}, "due_reviews": review["due_count"]}
    project = selected_project or projects[0]
    next_nodes = get_next_learnable_nodes(session, project.id, 1)
    progress = get_project_progress(session, project.id)
    state = "complete" if progress["total"] and progress["done"] == progress["total"] else "active"
    next_node = _node_data(next_nodes[0]) if next_nodes else None
    href = f"/courses/{project.id}/nodes/{next_nodes[0].id}" if next_nodes else "/review"
    return {
        "state": state,
        "configured": True,
        "current_project": _project_data(project, session),
        "next_node": next_node,
        "due_reviews": review["due_count"],
        "action": {"label": "继续学习" if next_node else "开始复习", "href": href},
    }


@router.get("/projects")
def projects(session: DB) -> dict:
    rows = session.exec(
        select(LearningProject)
        .where(LearningProject.user_id == CURRENT_USER_ID)
        .order_by(LearningProject.updated_at.desc(), LearningProject.id.desc())
    ).all()
    items = [_project_data(row, session) for row in rows]
    return {"items": items, "projects": items}


@router.get("/projects/{project_id}")
def project(project_id: int, session: DB) -> dict:
    return _project_data(require_project(session, project_id), session)


@router.delete("/projects/{project_id}")
def remove_project(project_id: int, session: DB) -> dict:
    require_project(session, project_id)
    return delete_project(session, project_id)


@router.get("/projects/{project_id}/roadmap")
def roadmap(project_id: int, session: DB) -> dict:
    require_project(session, project_id)
    return load_roadmap(session, project_id)


@router.get("/projects/{project_id}/nodes")
def nodes(project_id: int, session: DB) -> dict:
    require_project(session, project_id)
    rows = session.exec(select(KnowledgeNode).where(KnowledgeNode.project_id == project_id)).all()
    from learning_ext.progress.study import sort_nodes_by_code

    items = [_node_data(row) for row in sort_nodes_by_code(list(rows))]
    return {"items": items, "nodes": items}


@router.post("/projects/generate/stream")
def generate_project(body: ProjectGenerateRequest, request: Request):
    session_factory: Callable[[], Session] = request.app.state.session_factory

    def events(cancel: threading.Event):
        yield StreamEvent("progress", {"phase": "planning", "message": "正在拆解学习目标", "current": 1, "total": 3})
        if cancel.is_set():
            return
        result = generate_roadmap(body.topic, body.background, body.goal, body.weekly_hours)
        yield StreamEvent("progress", {"phase": "validating", "message": "正在检查课程顺序", "current": 2, "total": 3})
        if cancel.is_set():
            return
        payload: dict[str, Any] = {"roadmap": result}
        if body.save:
            with session_factory() as session:
                saved = save_roadmap(session, CURRENT_USER_ID, body.topic, body.background, body.goal, body.weekly_hours, result)
                payload["project_id"] = saved.id
        yield StreamEvent("result", {"kind": "roadmap", "payload": payload})

    return stream_response("roadmap", events)


@router.post("/projects/{project_id}/refine/stream")
def refine_project(project_id: int, body: ProjectRefineRequest, request: Request, session: DB):
    require_project(session, project_id)
    _acquire_stream_slot(_ACTIVE_PROJECTS, project_id, "这个学习计划正在更新，请等待当前操作结束")
    session_factory: Callable[[], Session] = request.app.state.session_factory

    def events(cancel: threading.Event):
        try:
            yield StreamEvent("progress", {"phase": "refining", "message": "正在根据你的意见调整路线", "current": 1, "total": 2})
            with session_factory() as worker_session:
                require_project(worker_session, project_id)
                current = load_roadmap(worker_session, project_id)
                improved = refine_roadmap(current, body.instruction)
                if cancel.is_set():
                    return
                replace_project_roadmap(worker_session, project_id, improved)
                payload = load_roadmap(worker_session, project_id)
            yield StreamEvent("progress", {"phase": "saving", "message": "正在保存新的课程顺序", "current": 2, "total": 2})
            yield StreamEvent("result", {"kind": "roadmap", "payload": payload})
        finally:
            _release_stream_slot(_ACTIVE_PROJECTS, project_id)

    return stream_response("roadmap-refine", events)


@router.post("/projects/{project_id}/audit/stream")
def audit_project(project_id: int, body: ProjectAuditRequest, request: Request, session: DB):
    require_project(session, project_id)
    _acquire_stream_slot(_ACTIVE_PROJECTS, project_id, "这个学习计划正在更新，请等待当前操作结束")
    session_factory: Callable[[], Session] = request.app.state.session_factory

    def events(cancel: threading.Event):
        try:
            yield StreamEvent("progress", {"phase": "auditing", "message": "正在检查遗漏、粒度和依赖关系", "current": 1, "total": 2})
            with session_factory() as worker_session:
                project = require_project(worker_session, project_id)
                current = load_roadmap(worker_session, project_id)
                audit, improved = audit_existing_roadmap(
                    current,
                    project.topic,
                    project.background,
                    project.goal,
                    project.weekly_hours,
                )
                if cancel.is_set():
                    return
                if body.apply:
                    replace_project_roadmap(worker_session, project_id, improved)
            yield StreamEvent("progress", {"phase": "complete", "message": "路线审计完成", "current": 2, "total": 2})
            yield StreamEvent(
                "result",
                {"kind": "roadmap-audit", "payload": {"audit": audit, "roadmap": improved, "applied": body.apply}},
            )
        finally:
            _release_stream_slot(_ACTIVE_PROJECTS, project_id)

    return stream_response("roadmap-audit", events)


@router.post("/projects/{project_id}/prepare/stream")
def prepare_project(project_id: int, request: Request, session: DB):
    require_project(session, project_id)
    _acquire_stream_slot(_ACTIVE_PROJECTS, project_id, "这个学习计划正在准备课程，请等待当前操作结束")
    session_factory: Callable[[], Session] = request.app.state.session_factory

    def events(cancel: threading.Event):
        try:
            from learning_ext.progress.study import sort_nodes_by_code

            with session_factory() as worker_session:
                project = require_project(worker_session, project_id)
                rows = sort_nodes_by_code(
                    list(worker_session.exec(select(KnowledgeNode).where(KnowledgeNode.project_id == project_id)).all())
                )
                pending = [node for node in rows if not is_content_valid(node.description)]
                total = len(pending)
                if total == 0:
                    yield StreamEvent("result", {"kind": "course-prepare", "payload": {"project_id": project_id, "prepared": 0}})
                    return
                prepared = 0
                for index, node in enumerate(pending, start=1):
                    if cancel.is_set():
                        return
                    yield StreamEvent(
                        "progress",
                        {"phase": "content", "message": f"正在准备 {node.code} {node.title}", "current": index - 1, "total": total, "item_id": node.id},
                    )
                    content = generate_node_summary(node, project.topic, learning_goal=project.goal)
                    if cancel.is_set():
                        return
                    node.description = content
                    worker_session.add(node)
                    worker_session.commit()
                    prepared += 1
                    yield StreamEvent(
                        "progress",
                        {"phase": "content", "message": f"已完成 {node.code} {node.title}", "current": index, "total": total, "item_id": node.id},
                    )
            yield StreamEvent("result", {"kind": "course-prepare", "payload": {"project_id": project_id, "prepared": prepared}})
        finally:
            _release_stream_slot(_ACTIVE_PROJECTS, project_id)

    return stream_response("course-prepare", events)


@router.get("/projects/{project_id}/export")
def export_project(project_id: int, session: DB):
    project = require_project(session, project_id)
    payload = export_roadmap_bundle(session, project_id)
    safe_id = str(project.id)
    return Response(
        payload,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="learning-route-{safe_id}.json"'},
    )


@router.post("/projects/import")
def import_project(body: ProjectImportRequest, session: DB) -> dict:
    try:
        project = import_roadmap_bundle(session, body.payload, user_id=CURRENT_USER_ID)
    except ValueError as exc:
        raise bad_request(str(exc), "ROADMAP_IMPORT_FAILED") from exc
    return _project_data(project, session)


@router.get("/nodes/{node_id}")
def node(node_id: int, session: DB) -> dict:
    owned = require_node(session, node_id)
    data = _node_data(owned)
    practice = get_practice_task(session, node_id)
    data["practice"] = practice.description if practice else None
    data["resources"] = [
        _resource_data(row)
        for row in get_resources(session, node_id)
    ]
    return data


@router.post("/nodes/{node_id}/content/stream")
def node_content(node_id: int, request: Request, session: DB):
    require_node(session, node_id)
    _acquire_stream_slot(_ACTIVE_NODES, node_id, "这一节正在生成内容，请等待当前操作结束")
    session_factory: Callable[[], Session] = request.app.state.session_factory

    def events(cancel: threading.Event):
        try:
            yield StreamEvent("progress", {"phase": "content", "message": "正在编写本节教学内容", "current": 0, "total": 1, "item_id": node_id})
            with session_factory() as worker_session:
                owned = require_node(worker_session, node_id)
                project = require_project(worker_session, owned.project_id)
                content = generate_node_summary(owned, project.topic, learning_goal=project.goal)
                if cancel.is_set():
                    return
                owned.description = content
                worker_session.add(owned)
                worker_session.commit()
                worker_session.refresh(owned)
                payload = _node_data(owned)
            yield StreamEvent("progress", {"phase": "content", "message": "本节内容已经准备好", "current": 1, "total": 1, "item_id": node_id})
            yield StreamEvent("result", {"kind": "node-content", "payload": payload})
        finally:
            _release_stream_slot(_ACTIVE_NODES, node_id)

    return stream_response("node-content", events)


@router.post("/nodes/{node_id}/practice/stream")
def node_practice(node_id: int, request: Request, session: DB):
    require_node(session, node_id)
    _acquire_stream_slot(_ACTIVE_NODES, node_id, "这一节正在生成实操，请等待当前操作结束")
    session_factory: Callable[[], Session] = request.app.state.session_factory

    def events(cancel: threading.Event):
        try:
            yield StreamEvent("progress", {"phase": "practice", "message": "正在设计可执行的实操步骤", "current": 0, "total": 1, "item_id": node_id})
            with session_factory() as worker_session:
                owned = require_node(worker_session, node_id)
                project = require_project(worker_session, owned.project_id)
                content = generate_practice_lesson(owned, project.topic, learning_goal=project.goal)
                if cancel.is_set():
                    return
                task = _save_practice_task(worker_session, owned, content, force=True)
                payload = {"id": task.id, "title": task.title, "content": task.description, "status": task.status}
            yield StreamEvent("progress", {"phase": "practice", "message": "实操课程已经准备好", "current": 1, "total": 1, "item_id": node_id})
            yield StreamEvent("result", {"kind": "node-practice", "payload": payload})
        finally:
            _release_stream_slot(_ACTIVE_NODES, node_id)

    return stream_response("node-practice", events)


@router.patch("/nodes/{node_id}/status")
def node_status(node_id: int, body: NodeStatusRequest, session: DB) -> dict:
    require_node(session, node_id)
    return _node_data(set_node_status(session, node_id, body.status))


@router.get("/nodes/{node_id}/note")
def note(node_id: int, session: DB) -> dict:
    require_node(session, node_id)
    saved = get_note(session, node_id, CURRENT_USER_ID)
    content = saved.content if saved else ""
    return {"content": content, "note": content, "selection": saved.selection if saved else ""}


@router.put("/nodes/{node_id}/note")
def put_note(node_id: int, body: NoteRequest, session: DB) -> dict:
    owned = require_node(session, node_id)
    saved = save_note(
        session,
        node_id,
        owned.project_id,
        body.content,
        CURRENT_USER_ID,
        body.selection,
    )
    return {"content": saved.content, "note": saved.content, "selection": saved.selection, "updated_at": saved.updated_at.isoformat()}


@router.get("/nodes/{node_id}/resources")
def resources(node_id: int, session: DB) -> dict:
    require_node(session, node_id)
    rows = get_resources(session, node_id)
    return {"items": [_resource_data(row) for row in rows]}


@router.post("/nodes/{node_id}/resources/stream")
def node_resources(node_id: int, request: Request, session: DB):
    require_node(session, node_id)
    _acquire_stream_slot(_ACTIVE_NODES, node_id, "这一节正在生成内容，请等待当前操作结束")
    session_factory: Callable[[], Session] = request.app.state.session_factory

    def events(cancel: threading.Event):
        try:
            yield StreamEvent(
                "progress",
                {
                    "phase": "resources",
                    "message": "正在查找与本节正文直接相关的资料",
                    "current": 0,
                    "total": 2,
                    "item_id": node_id,
                },
            )
            with session_factory() as worker_session:
                owned = require_node(worker_session, node_id)
                project = require_project(worker_session, owned.project_id)
                generated = generate_resources(
                    owned,
                    project.topic,
                    fetch_content=False,
                )
                if cancel.is_set():
                    return
                saved = save_resources_to_db(
                    worker_session,
                    owned.id,
                    project.id,
                    generated,
                )
                payload = [_resource_data(row) for row in saved]
            yield StreamEvent(
                "progress",
                {
                    "phase": "resources",
                    "message": f"已整理 {len(payload)} 份参考资料",
                    "current": 2,
                    "total": 2,
                    "item_id": node_id,
                },
            )
            yield StreamEvent(
                "result",
                {
                    "kind": "node-resources",
                    "payload": {"node_id": node_id, "resources": payload},
                },
            )
        finally:
            _release_stream_slot(_ACTIVE_NODES, node_id)

    return stream_response("node-resources", events)


@router.get("/review/stats")
def review_stats(session: DB) -> dict:
    stats = get_review_stats(session, CURRENT_USER_ID)
    return {
        **stats,
        "due": stats["due_count"],
        "learning": stats["learning_cards"],
        "mastered": max(0, stats["total_cards"] - stats["due_count"]),
        "reviewedToday": 0,
    }


@router.get("/review/next")
def review_next(session: DB) -> dict | None:
    cards = get_due_cards(session, CURRENT_USER_ID, limit=1)
    if not cards:
        return None
    card = cards[0]
    return {
        "id": str(card.id),
        "card_id": card.id,
        "prompt": card.front,
        "question": card.front,
        "answer": card.back,
        "project_id": card.project_id,
        "node_id": card.node_id,
    }


@router.post("/review/{card_id}/rate")
def rate(card_id: int, body: ReviewRequest, session: DB) -> dict:
    require_card(session, card_id)
    reviewed = review_card(session, card_id, body.rating, CURRENT_USER_ID)
    return {"reviewed": {"id": reviewed.id, "next_review": reviewed.next_review.isoformat()}, "next": review_next(session)}


@router.get("/dashboard")
def dashboard(session: DB, project_id: int | None = None) -> dict:
    if project_id is not None:
        require_project(session, project_id)
    data = build_dashboard_data(session, CURRENT_USER_ID, project_id)
    data["projects"] = [{"label": label, "id": int(value)} for label, value in data["projects"]]
    data["trend"] = [
        {"date": item["date"], "minutes": item["minutes"], "completed": 0}
        for item in data["heatmap"]
    ]
    data["statusCounts"] = data["status_counts"]
    data["dailyNote"] = data["latest_report"]
    return data


@router.get("/config/status")
def get_config() -> dict:
    status = config_status()
    return {
        **status,
        "model": status["chat_model"],
        "baseUrl": status["base_url"],
        "chatModel": status["chat_model"],
        "embeddingModel": status["embedding_model"],
        "embeddingReady": status["rag_ready"],
        "capabilities": [name for name, ready in (("chat", status["chat_ready"]), ("rag", status["rag_ready"])) if ready],
    }


def _resolved_config(body: ConfigRequest) -> tuple[str, str]:
    defaults = {
        "openai": ("https://api.openai.com/v1", "gpt-4o-mini"),
        "deepseek": ("https://api.deepseek.com/v1", "deepseek-chat"),
        "moonshot": ("https://api.moonshot.cn/v1", "moonshot-v1-8k"),
    }
    default_url, default_model = defaults.get(body.provider, ("", ""))
    return body.base_url or default_url, body.chat_model or default_model


@router.put("/config")
def put_config(body: ConfigRequest) -> dict:
    base_url, chat_model = _resolved_config(body)
    if not base_url.startswith(("http://", "https://")):
        raise bad_request("接口地址必须使用 http 或 https")
    try:
        save_config(
            base_url=base_url,
            api_key=body.api_key,
            chat_model=chat_model,
            embedding_model=body.embedding_model,
            provider=body.provider,
        )
    except ApiKeyRequired as exc:
        raise bad_request("首次保存时请填写 API Key", "API_KEY_REQUIRED") from exc
    except RuntimeConfigApplyError as exc:
        raise ApiError(
            500,
            "CONFIG_APPLY_FAILED",
            "运行时模型更新失败，配置文件已恢复；请重启应用后重试",
        ) from exc
    return get_config()


@router.post("/config/test")
def test_config(body: ConfigRequest) -> dict:
    import requests

    base_url, chat_model = _resolved_config(body)
    if not base_url:
        raise bad_request("请填写接口地址")
    api_key = body.api_key
    if not api_key:
        api_key = get_saved_api_key()
    if not api_key:
        raise bad_request("请先填写 API Key", "API_KEY_REQUIRED")
    try:
        response = requests.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": chat_model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1},
            timeout=(5, 20),
        )
    except requests.Timeout as exc:
        raise bad_request("连接模型服务超时", "UPSTREAM_TIMEOUT") from exc
    except requests.RequestException as exc:
        raise bad_request("无法连接模型服务", "UPSTREAM_UNAVAILABLE") from exc
    if response.status_code in {401, 403}:
        raise bad_request("API Key 无效或无权访问", "AUTH_FAILED")
    if response.status_code == 404:
        raise bad_request("没有找到该模型或接口", "MODEL_NOT_FOUND")
    if not response.ok:
        raise bad_request("模型服务暂时不可用", "UPSTREAM_UNAVAILABLE")
    return {"ok": True, "message": "连接成功"}


def _conversation_model():
    from ktem.db.models import Conversation

    return Conversation


def _conversation_data(row) -> dict:
    source = row.data_source if isinstance(row.data_source, dict) else {}
    return {
        "id": row.id,
        "title": row.name,
        "updated_at": row.date_updated.isoformat(),
        "updatedAt": row.date_updated.isoformat(),
        "messageCount": len(source.get("messages", [])),
        "messages": source.get("messages", []),
        "file_ids": source.get("file_ids"),
        "fileIds": source.get("file_ids"),
    }


def _require_conversation(session: Session, conversation_id: str):
    Conversation = _conversation_model()
    row = session.exec(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .where(Conversation.user == CURRENT_USER_ID)
    ).first()
    if row is None:
        from learning_ext.api.errors import not_found

        raise not_found()
    return row


@router.get("/chat/conversations")
def conversations(session: DB) -> dict:
    Conversation = _conversation_model()
    rows = session.exec(
        select(Conversation)
        .where(Conversation.user == CURRENT_USER_ID)
        .order_by(Conversation.date_updated.desc())
    ).all()
    items = [_conversation_data(row) for row in rows]
    return {"items": items, "conversations": items}


@router.post("/chat/conversations")
def create_conversation(body: ConversationCreateRequest, session: DB) -> dict:
    Conversation = _conversation_model()
    row = Conversation(name=body.title, user=CURRENT_USER_ID, data_source={"messages": []})
    session.add(row)
    session.commit()
    session.refresh(row)
    return _conversation_data(row)


@router.get("/chat/conversations/{conversation_id}")
def conversation(conversation_id: str, session: DB) -> dict:
    return _conversation_data(_require_conversation(session, conversation_id))


@router.patch("/chat/conversations/{conversation_id}")
def update_conversation(conversation_id: str, body: ConversationUpdateRequest, session: DB) -> dict:
    from datetime import datetime

    row = _require_conversation(session, conversation_id)
    row.name = body.title
    row.date_updated = datetime.now(row.date_updated.tzinfo)
    session.add(row)
    session.commit()
    session.refresh(row)
    return _conversation_data(row)


@router.delete("/chat/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, session: DB) -> dict:
    row = _require_conversation(session, conversation_id)
    session.delete(row)
    session.commit()
    return {"deleted": True}


@router.post("/chat/stream")
def chat_stream(body: ChatRequest, request: Request, session: DB):
    if body.node_id is not None:
        contextual_node = require_node(session, body.node_id)
        if body.project_id is not None and contextual_node.project_id != body.project_id:
            from learning_ext.api.errors import not_found

            raise not_found()
    elif body.project_id is not None:
        require_project(session, body.project_id)
    if body.conversation_id:
        _require_conversation(session, body.conversation_id)
        with _STREAM_LOCK:
            if body.conversation_id in _ACTIVE_CONVERSATIONS:
                raise ApiError(409, "RESOURCE_BUSY", "这个对话正在生成回答，请等待当前请求结束")
            _ACTIVE_CONVERSATIONS.add(body.conversation_id)
    session_factory: Callable[[], Session] = request.app.state.session_factory

    def events(cancel: threading.Event):
        answer: list[str] = []
        citations: list[dict[str, Any]] = []
        try:
            history: list[tuple[str, str]] = []
            prompt = body.message
            if body.node_id is not None:
                with session_factory() as worker_session:
                    contextual_node = require_node(worker_session, body.node_id)
                    contextual_project = require_project(
                        worker_session,
                        contextual_node.project_id,
                    )
                    lesson = (contextual_node.description or "尚未生成教学正文")[:12_000]
                    prompt = (
                        "你是当前课程节点的学习助教。请优先围绕给定课程上下文回答，"
                        "明确区分课程已有内容和你的补充说明。\n\n"
                        f"【项目】{contextual_project.title}\n"
                        f"【学习主题】{contextual_project.topic}\n"
                        f"【当前节点】{contextual_node.code} {contextual_node.title}\n"
                        f"【本节正文】\n{lesson}\n\n"
                        f"【学习者问题】{body.message}"
                    )
            if body.conversation_id:
                with session_factory() as worker_session:
                    row = _require_conversation(worker_session, body.conversation_id)
                    saved_messages = list((row.data_source or {}).get("messages", []))
                pending_user: str | None = None
                for message in saved_messages:
                    if message.get("role") == "user":
                        pending_user = str(message.get("content") or "")
                    elif message.get("role") == "assistant" and pending_user is not None:
                        history.append((pending_user, str(message.get("content") or "")))
                        pending_user = None
            runtime = request.app.state.runtime
            if runtime is not None and hasattr(runtime, "stream_chat"):
                stream = runtime.stream_chat(
                    user_id=CURRENT_USER_ID,
                    message=prompt,
                    conversation_id=body.conversation_id or "ephemeral",
                    history=history,
                    file_ids=body.file_ids,
                    cancel=cancel,
                )
                for item in stream:
                    if cancel.is_set():
                        return
                    event_type = item["type"]
                    data = item["data"]
                    if event_type == "delta":
                        answer.append(str(data.get("text") or ""))
                    elif event_type == "citation":
                        citations.append(dict(data))
                    yield StreamEvent(event_type, data)
            else:
                from learning_ext.llm import chat

                response = chat(prompt, stream=True)
                for token in response:
                    if cancel.is_set():
                        return
                    if token:
                        answer.append(token)
                        yield StreamEvent("delta", {"text": token})
            if not "".join(answer).strip():
                raise RuntimeError("EMPTY_ANSWER")
            if body.conversation_id and not cancel.is_set():
                with session_factory() as worker_session:
                    row = _require_conversation(worker_session, body.conversation_id)
                    source = dict(row.data_source or {})
                    messages = list(source.get("messages", []))
                    messages.extend(
                        [
                            {"role": "user", "content": body.message},
                            {"role": "assistant", "content": "".join(answer), "citations": citations},
                        ]
                    )
                    source["messages"] = messages
                    source["file_ids"] = body.file_ids
                    row.data_source = source
                    from datetime import datetime

                    row.date_updated = datetime.now(row.date_updated.tzinfo)
                    worker_session.add(row)
                    worker_session.commit()
            yield StreamEvent(
                "result",
                {"kind": "chat", "payload": {"conversation_id": body.conversation_id, "citations": citations}},
            )
        finally:
            if body.conversation_id:
                with _STREAM_LOCK:
                    _ACTIVE_CONVERSATIONS.discard(body.conversation_id)

    return stream_response("chat", events)


@router.get("/library/indices")
def indices(request: Request) -> dict:
    runtime = request.app.state.runtime
    if runtime is None or not hasattr(runtime, "list_indices"):
        return {"items": [], "files": [], "available": False, "message": "资料库运行时尚未就绪，可在高级界面管理"}
    return {"items": runtime.list_indices(CURRENT_USER_ID), "available": True}


@router.get("/library/files")
def files(request: Request, index_id: str | None = None, query: str = "") -> dict:
    runtime = request.app.state.runtime
    if runtime is None or not hasattr(runtime, "list_files"):
        return {"items": [], "files": [], "available": False}
    items = runtime.list_files(CURRENT_USER_ID, index_id, query)
    return {"items": items, "files": items, "available": True}


@router.delete("/library/files/{file_id}")
def delete_file(file_id: str, request: Request) -> dict:
    runtime = request.app.state.runtime
    if runtime is None or not hasattr(runtime, "delete_file"):
        from learning_ext.api.errors import not_found

        raise not_found()
    _acquire_stream_slot(_ACTIVE_INDICES, "library", "资料库正在执行其他写入操作")
    try:
        try:
            deleted = runtime.delete_file(CURRENT_USER_ID, file_id)
        except FileCleanupIncomplete as exc:
            raise ApiError(500, "FILE_CLEANUP_INCOMPLETE", "资料记录已移除，但部分索引产物清理失败；请重启后重试清理") from exc
    finally:
        _release_stream_slot(_ACTIVE_INDICES, "library")
    if not deleted:
        from learning_ext.api.errors import not_found

        raise not_found()
    return {"deleted": True}


@router.get("/library/files/{file_id}/download")
def download_file(file_id: str, request: Request):
    runtime = request.app.state.runtime
    if runtime is None or not hasattr(runtime, "download_file"):
        from learning_ext.api.errors import not_found

        raise not_found()
    resolved = runtime.download_file(CURRENT_USER_ID, file_id)
    if resolved is None:
        from learning_ext.api.errors import not_found

        raise not_found()
    path, name = resolved
    return FileResponse(path, filename=name, media_type="application/octet-stream")


@router.get("/library/groups")
def groups(request: Request, index_id: str | None = None) -> dict:
    runtime = request.app.state.runtime
    if runtime is None or not hasattr(runtime, "list_groups"):
        return {"items": [], "groups": [], "available": False}
    items = runtime.list_groups(CURRENT_USER_ID, index_id)
    return {"items": items, "groups": items, "available": True}


@router.post("/library/groups")
def create_group(body: LibraryGroupCreateRequest, request: Request) -> dict:
    runtime = request.app.state.runtime
    if runtime is None or not hasattr(runtime, "create_group"):
        from learning_ext.api.errors import not_found

        raise not_found()
    _acquire_stream_slot(_ACTIVE_INDICES, "library", "资料库正在执行其他写入操作")
    try:
        try:
            return runtime.create_group(CURRENT_USER_ID, body.index_id, body.name, body.file_ids)
        except FileExistsError as exc:
            raise bad_request("已经有同名分组", "GROUP_ALREADY_EXISTS") from exc
        except LookupError as exc:
            from learning_ext.api.errors import not_found

            raise not_found() from exc
    finally:
        _release_stream_slot(_ACTIVE_INDICES, "library")


@router.patch("/library/groups/{group_id}")
def update_group(group_id: str, body: LibraryGroupUpdateRequest, request: Request) -> dict:
    runtime = request.app.state.runtime
    if runtime is None or not hasattr(runtime, "update_group"):
        from learning_ext.api.errors import not_found

        raise not_found()
    _acquire_stream_slot(_ACTIVE_INDICES, "library", "资料库正在执行其他写入操作")
    try:
        try:
            group = runtime.update_group(
                CURRENT_USER_ID,
                group_id,
                name=body.name,
                file_ids=body.file_ids,
            )
        except FileExistsError as exc:
            raise bad_request("已经有同名分组", "GROUP_ALREADY_EXISTS") from exc
        except LookupError as exc:
            from learning_ext.api.errors import not_found

            raise not_found() from exc
    finally:
        _release_stream_slot(_ACTIVE_INDICES, "library")
    if group is None:
        from learning_ext.api.errors import not_found

        raise not_found()
    return group


@router.delete("/library/groups/{group_id}")
def delete_group(group_id: str, request: Request) -> dict:
    runtime = request.app.state.runtime
    if runtime is None or not hasattr(runtime, "delete_group"):
        from learning_ext.api.errors import not_found

        raise not_found()
    _acquire_stream_slot(_ACTIVE_INDICES, "library", "资料库正在执行其他写入操作")
    try:
        deleted = runtime.delete_group(CURRENT_USER_ID, group_id)
    finally:
        _release_stream_slot(_ACTIVE_INDICES, "library")
    if not deleted:
        from learning_ext.api.errors import not_found

        raise not_found()
    return {"deleted": True}


@router.post("/library/index/stream")
async def index_file(request: Request):
    runtime = request.app.state.runtime
    content_type = request.headers.get("content-type", "")
    temporary_root: Path | None = None
    upload_path: Path | None = None
    index_id: str | None = None
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        index_value = form.get("index_id")
        index_id = str(index_value) if index_value else None
        if upload is None or not hasattr(upload, "read"):
            raise bad_request("请选择要上传的文件", "FILE_UPLOAD_REQUIRED")
        raw_name = str(getattr(upload, "filename", "") or "").replace("\\", "/")
        safe_name = raw_name.rsplit("/", 1)[-1]
        if not safe_name or Path(safe_name).suffix.lower() not in _ALLOWED_UPLOAD_SUFFIXES:
            raise bad_request("暂不支持这种文件类型", "FILE_TYPE_UNSUPPORTED")
        temporary_root = Path(tempfile.mkdtemp(prefix="le-index-"))
        upload_path = temporary_root / safe_name
        size = 0
        try:
            with upload_path.open("wb") as handle:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > _MAX_UPLOAD_BYTES:
                        raise bad_request("文件大小超过 200 MB", "FILE_TOO_LARGE")
                    handle.write(chunk)
        except Exception:
            shutil.rmtree(temporary_root, ignore_errors=True)
            raise
        finally:
            close = getattr(upload, "close", None)
            if callable(close):
                await close()
    else:
        try:
            body = LibraryIndexRequest.model_validate(await request.json())
        except Exception as exc:
            raise bad_request("请选择要上传的文件", "FILE_UPLOAD_REQUIRED") from exc
        index_id = body.index_id

        def rejected_events(_cancel: threading.Event):
            if body.url:
                yield StreamEvent(
                    "error",
                    {
                        "code": "URL_NOT_ALLOWED",
                        "message": "为避免内网请求风险，当前版本暂不开放网页索引；请下载后上传文件",
                        "retryable": False,
                    },
                )
                return
            yield StreamEvent(
                "error",
                {
                    "code": "FILE_UPLOAD_REQUIRED",
                    "message": "请选择并上传真实文件内容，不能只提交文件名",
                    "retryable": False,
                },
            )

        return stream_response("library-index", rejected_events)

    lock_key = "library"
    with _STREAM_LOCK:
        if lock_key in _ACTIVE_INDICES:
            if temporary_root is not None:
                shutil.rmtree(temporary_root, ignore_errors=True)
            raise ApiError(409, "RESOURCE_BUSY", "这个资料库正在执行索引或删除操作")
        _ACTIVE_INDICES.add(lock_key)

    def events(cancel: threading.Event):
        try:
            if runtime is None or not hasattr(runtime, "stream_index_file"):
                yield StreamEvent("error", {"code": "RAG_NOT_CONFIGURED", "message": "资料库运行时尚未就绪", "retryable": False})
                return
            assert upload_path is not None
            try:
                for item in runtime.stream_index_file(
                    user_id=CURRENT_USER_ID,
                    index_id=index_id,
                    file_path=upload_path,
                    cancel=cancel,
                ):
                    yield StreamEvent(item["type"], item["data"])
            except FileExistsError:
                yield StreamEvent(
                    "error",
                    {"code": "FILE_ALREADY_INDEXED", "message": "同名资料已经存在，请先删除后再上传", "retryable": False},
                )
            except LookupError:
                yield StreamEvent("error", {"code": "RAG_NOT_CONFIGURED", "message": "资料库运行时尚未就绪", "retryable": False})
            except FileCleanupIncomplete:
                yield StreamEvent("error", {"code": "FILE_CLEANUP_INCOMPLETE", "message": "索引失败，且部分临时索引产物未能清理；请重启后删除该资料", "retryable": False})
            except Exception:
                yield StreamEvent("error", {"code": "FILE_INDEX_FAILED", "message": "资料索引失败，已清理本次产生的内容", "retryable": True})
        finally:
            if temporary_root is not None:
                shutil.rmtree(temporary_root, ignore_errors=True)
            with _STREAM_LOCK:
                _ACTIVE_INDICES.discard(lock_key)

    return stream_response("library-index", events)
