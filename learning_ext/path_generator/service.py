"""路线生成 Agent。

输入：选题 + 背景 + 目标 + 可用时间
输出：学习路线 JSON (含阶段、知识 DAG 节点、依赖边)
持久化：写入 LearningProject + KnowledgeNode + KnowledgeEdge
"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy.orm import Session
from sqlmodel import select

from learning_ext.db.models import (
    KnowledgeEdge,
    KnowledgeNode,
    LearningProject,
)
from learning_ext.llm import chat_json
from learning_ext.path_generator.prompts import (
    REFINE_SYSTEM,
    REFINE_USER_TEMPLATE,
    SYSTEM,
    USER_TEMPLATE,
)


def generate_roadmap(
    topic: str,
    background: str,
    goal: str,
    weekly_hours: float,
    *,
    model_name: Optional[str] = None,
) -> dict:
    """调用 LLM 生成学习路线 (纯函数，不落库)。

    Returns:
        路线 dict，结构见 prompts.SYSTEM
    """
    prompt = USER_TEMPLATE.format(
        topic=topic,
        background=background or "无特殊背景，默认初学者",
        goal=goal or "掌握该主题的核心知识并能应用",
        weekly_hours=weekly_hours,
    )
    return chat_json(prompt, system=SYSTEM, model_name=model_name)


def refine_roadmap(
    current_roadmap: dict,
    instruction: str,
    *,
    model_name: Optional[str] = None,
) -> dict:
    """根据用户意见调整已有路线。"""
    prompt = REFINE_USER_TEMPLATE.format(
        current_roadmap=json.dumps(current_roadmap, ensure_ascii=False, indent=2),
        instruction=instruction,
    )
    return chat_json(prompt, system=REFINE_SYSTEM, model_name=model_name)


def save_roadmap(
    session: Session,
    user_id: str,
    topic: str,
    background: str,
    goal: str,
    weekly_hours: float,
    roadmap: dict,
    title: Optional[str] = None,
) -> LearningProject:
    """把路线 JSON 落库为 Project + Nodes + Edges。

    Returns:
        创建的 LearningProject
    """
    project = LearningProject(
        user_id=user_id,
        title=title or roadmap.get("summary", topic)[:80] or topic,
        topic=topic,
        background=background,
        goal=goal,
        weekly_hours=weekly_hours,
        roadmap_json=json.dumps(roadmap, ensure_ascii=False),
        status="active",
    )
    session.add(project)
    session.flush()  # 拿到 project.id

    # code -> node_id 映射，用于建边
    code_to_id: dict[str, int] = {}

    for node_data in roadmap.get("nodes", []):
        node = KnowledgeNode(
            project_id=project.id,
            code=node_data["code"],
            title=node_data["title"],
            description=node_data.get("description", ""),
            stage=node_data.get("stage", "base"),
            est_hours=float(node_data.get("est_hours", 2.0)),
            difficulty=int(node_data.get("difficulty", 3)),
            mastery=0.0,
            status="pending",
        )
        session.add(node)
        session.flush()
        code_to_id[node.code] = node.id

    # 建依赖边：node 的 prerequisites 中的 code 是前置
    for node_data in roadmap.get("nodes", []):
        source_code = node_data["code"]
        source_id = code_to_id.get(source_code)
        if source_id is None:
            continue
        for prereq_code in node_data.get("prerequisites", []):
            target_id = code_to_id.get(prereq_code)
            if target_id is None or target_id == source_id:
                continue
            edge = KnowledgeEdge(
                project_id=project.id,
                source_id=source_id,
                target_id=target_id,
                relation="prerequisite",
            )
            session.add(edge)

    session.commit()
    return project


def load_roadmap(session: Session, project_id: int) -> dict:
    """从库重建路线 JSON (含节点最新状态)。"""
    project = session.get(LearningProject, project_id)
    if project is None:
        raise ValueError(f"Project {project_id} not found")

    nodes = session.exec(
        select(KnowledgeNode).where(KnowledgeNode.project_id == project_id)
    ).all()
    edges = session.exec(
        select(KnowledgeEdge).where(KnowledgeEdge.project_id == project_id)
    ).all()

    # 构造 prerequisites
    prereq_map: dict[str, list[str]] = {}
    code_by_id = {n.id: n.code for n in nodes}
    for e in edges:
        src_code = code_by_id.get(e.source_id, "")
        tgt_code = code_by_id.get(e.target_id, "")
        prereq_map.setdefault(src_code, []).append(tgt_code)

    return {
        "summary": project.title,
        "stages": _distinct_stages(nodes),
        "nodes": [
            {
                "code": n.code,
                "title": n.title,
                "description": n.description,
                "stage": n.stage,
                "est_hours": n.est_hours,
                "difficulty": n.difficulty,
                "prerequisites": prereq_map.get(n.code, []),
                "mastery": n.mastery,
                "status": n.status,
            }
            for n in sorted(nodes, key=lambda x: x.code)
        ],
    }


def _distinct_stages(nodes):
    seen = []
    for n in nodes:
        if n.stage not in [s["stage"] for s in seen]:
            seen.append({"name": n.stage, "stage": n.stage, "goal": ""})
    return seen
