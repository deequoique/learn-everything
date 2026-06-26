"""学习笔记与参考资料 service。"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from sqlmodel import Session, select

from learning_ext.db.models import (
    KnowledgeNode,
    LearningProject,
    NodeNote,
    NodeResource,
)
from learning_ext.llm import chat

logger = logging.getLogger(__name__)


# ==================== 笔记 ====================


def get_note(
    session: Session, node_id: int, user_id: str = "default"
) -> Optional[NodeNote]:
    """获取某知识点的笔记 (每节点一条)。"""
    return session.exec(
        select(NodeNote)
        .where(NodeNote.node_id == node_id)
        .where(NodeNote.user_id == user_id)
    ).first()


def save_note(
    session: Session,
    node_id: int,
    project_id: int,
    content: str,
    user_id: str = "default",
) -> NodeNote:
    """保存/更新笔记 (upsert)。"""
    note = get_note(session, node_id, user_id)
    if note:
        note.content = content
        note.updated_at = datetime.utcnow()
    else:
        note = NodeNote(
            user_id=user_id,
            node_id=node_id,
            project_id=project_id,
            content=content,
        )
    session.add(note)
    session.commit()
    session.refresh(note)
    return note


# ==================== 参考资料 ====================


def get_resources(session: Session, node_id: int) -> List[NodeResource]:
    return session.exec(
        select(NodeResource)
        .where(NodeResource.node_id == node_id)
        .order_by(NodeResource.id)
    ).all()


def generate_resources(node: KnowledgeNode, project_topic: str) -> List[dict]:
    """AI 为知识点生成参考资料清单。"""
    prompt = f"""请为以下学习知识点推荐 5-8 个高质量参考资料。返回 JSON 数组，每项：
{{
  "title": "资料名称",
  "url": "链接 (官方文档/知名教程优先, 没有确切url则填搜索关键词url)",
  "rtype": "doc|video|book|article|tool|search",
  "description": "为什么推荐这个资料 + 它涵盖什么 (1-2句)"
}}

【学习主题】{project_topic}
【知识点】{node.title} ({node.code})
【知识点说明】{(node.description or "")[:300]}

规则：
- 优先推荐官方文档、经典书籍、知名开源项目
- rtype=search 表示这是一个搜索关键词建议 (url 填 https://www.google.com/search?q=关键词)
- 资料要真实存在, 不要编造
- 只返回 JSON 数组"""
    from learning_ext.llm import chat_json

    result = chat_json(prompt)
    if isinstance(result, list):
        return result
    return result.get("resources", []) if isinstance(result, dict) else []


def save_resources_to_db(
    session: Session, node_id: int, project_id: int, resources: List[dict]
) -> List[NodeResource]:
    """把 AI 生成的参考资料存库 (替换旧的)。"""
    # 清理旧 AI 资源
    old = session.exec(
        select(NodeResource)
        .where(NodeResource.node_id == node_id)
        .where(NodeResource.source == "ai")
    ).all()
    for r in old:
        session.delete(r)
    created = []
    for item in resources:
        r = NodeResource(
            node_id=node_id,
            project_id=project_id,
            title=item.get("title", ""),
            url=item.get("url", ""),
            rtype=item.get("rtype", "doc"),
            description=item.get("description", ""),
            source="ai",
        )
        session.add(r)
        created.append(r)
    session.commit()
    return created


def fetch_preview(url: str) -> str:
    """抓取 URL 内容作为预览 (简单版: 尝试请求并提取文本)。"""
    if not url or not url.startswith("http"):
        return "*该资料无可预览的链接*"
    try:
        import requests

        resp = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code != 200:
            return f"*无法访问 (HTTP {resp.status_code})*"
        text = resp.text
        # 简单提取: 去标签, 取前 1500 字符
        import re

        text = re.sub(r"<script[\s\S]*?</script>", "", text, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        title_match = re.search(r"<title>(.*?)</title>", resp.text, re.I | re.S)
        title = title_match.group(1).strip() if title_match else url
        return f"## {title}\n\n来源: {url}\n\n{text[:1500]}..."
    except Exception as e:
        return f"*预览失败: {e}*"


# ==================== 划词 AI 解释 ====================


def explain_term(term: str, node: KnowledgeNode, project_topic: str) -> str:
    """AI 解释选中名词 (快速术语解释, 区别于追问)。"""
    prompt = f"""学习者正在学习「{project_topic}」的「{node.title}」这一节。
阅读教学内容时，遇到了一个不懂的名词/术语：**{term}**

请简洁地解释这个名词：
1. 它是什么 (1-2句直白解释)
2. 在当前学习背景下它为什么重要 / 怎么用 (1-2句)
3. 举一个通俗的例子 (如果适用)

用 Markdown，**控制在 200 字以内**。直接给解释，不要前言。"""
    return chat(
        prompt,
        system="你是术语词典 + 耐心导师, 擅长用最简单的话解释专业名词。",
        temperature=0.3,
        max_tokens=500,
    )
