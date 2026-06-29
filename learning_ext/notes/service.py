"""学习笔记与参考资料 service。"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlparse

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
    """AI 推荐资料、抓取正文，并基于抓取内容生成学习汇报。"""
    prompt = f"""请为以下学习知识点推荐 4-6 个高质量、可直接阅读和抓取正文的公开网页资料。返回 JSON 数组，每项：
{{
  "title": "资料名称",
  "url": "可直接打开的资料页面链接",
  "rtype": "doc|article|tool",
  "description": "为什么推荐这个资料 + 它涵盖什么 (1-2句)"
}}

【学习主题】{project_topic}
【知识点】{node.title} ({node.code})
【知识点说明】{(node.description or "")[:300]}

规则：
- 优先推荐官方文档、权威教程、知名开源项目文档、可阅读的技术文章
- 不要返回搜索结果页、视频站首页、书籍购买页、需要登录的页面
- 资料要真实存在, 不要编造
- 只返回 JSON 数组"""
    from learning_ext.llm import chat_json

    result = chat_json(prompt)
    if isinstance(result, list):
        candidates = result
    else:
        candidates = result.get("resources", []) if isinstance(result, dict) else []

    fetched_resources: list[dict] = []
    for item in candidates[:6]:
        url = str(item.get("url", "")).strip()
        if not _is_fetchable_url(url):
            continue
        fetched = fetch_resource_content(url)
        resource = {
            "title": fetched.get("title") or item.get("title", ""),
            "url": fetched.get("url") or url,
            "rtype": item.get("rtype", "article"),
            "description": item.get("description", ""),
            "preview": fetched.get("content", ""),
            "fetch_status": fetched.get("status", ""),
        }
        if fetched.get("ok") and len(resource["preview"]) >= 300:
            fetched_resources.append(resource)
        else:
            resource["description"] = (
                f"{resource['description']}\n\n抓取失败：{fetched.get('error', '正文过短或不可读')}"
            ).strip()
            fetched_resources.append(resource)

    report = summarize_fetched_resources(node, project_topic, fetched_resources)
    return [
        {
            "title": "AI 资料学习汇报",
            "url": "",
            "rtype": "summary",
            "description": report,
            "preview": "",
        },
        *fetched_resources,
    ]


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
            preview=item.get("preview", ""),
            source="ai",
        )
        session.add(r)
        created.append(r)
    session.commit()
    return created


def _is_fetchable_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _extract_text_from_html(html: str) -> tuple[str, str]:
    """Extract a page title and readable text from HTML."""
    title = ""
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
        for tag in soup(
            [
                "script",
                "style",
                "noscript",
                "svg",
                "nav",
                "footer",
                "header",
                "form",
                "aside",
            ]
        ):
            tag.decompose()
        main = soup.find("main") or soup.find("article") or soup.body or soup
        text = main.get_text("\n", strip=True)
    except Exception:
        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
        title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""
        text = re.sub(r"<script[\s\S]*?</script>", "", html, flags=re.I)
        text = re.sub(r"<style[\s\S]*?</style>", "", text, flags=re.I)
        text = re.sub(r"<[^>]+>", "\n", text)

    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    return title, text


def fetch_resource_content(url: str, *, max_chars: int = 12000) -> dict:
    """Fetch a resource URL and return extracted readable text."""
    if not _is_fetchable_url(url):
        return {"ok": False, "url": url, "error": "不是可抓取的 HTTP/HTTPS 链接"}
    try:
        import requests

        resp = requests.get(
            url,
            timeout=18,
            allow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            },
        )
        if resp.status_code != 200:
            return {
                "ok": False,
                "url": resp.url or url,
                "status": resp.status_code,
                "error": f"HTTP {resp.status_code}",
            }

        content_type = resp.headers.get("content-type", "").lower()
        if "text/plain" in content_type:
            title = urlparse(resp.url).path.rsplit("/", 1)[-1] or resp.url
            text = resp.text
        elif "html" in content_type or not content_type:
            title, text = _extract_text_from_html(resp.text)
        else:
            return {
                "ok": False,
                "url": resp.url or url,
                "status": resp.status_code,
                "error": f"暂不支持抓取该内容类型：{content_type or 'unknown'}",
            }

        text = re.sub(r"\s+\n", "\n", text).strip()
        if len(text) < 200:
            return {
                "ok": False,
                "title": title,
                "url": resp.url or url,
                "status": resp.status_code,
                "content": text,
                "error": "页面正文过短，可能需要登录或主要内容由脚本渲染",
            }
        return {
            "ok": True,
            "title": title or resp.url or url,
            "url": resp.url or url,
            "status": resp.status_code,
            "content": text[:max_chars],
        }
    except Exception as e:
        return {"ok": False, "url": url, "error": str(e)}


def summarize_fetched_resources(
    node: KnowledgeNode, project_topic: str, resources: List[dict]
) -> str:
    """Ask the LLM to summarize fetched resource contents into a study report."""
    readable = [r for r in resources if r.get("preview") and len(r["preview"]) >= 300]
    if not readable:
        return (
            "没有成功抓取到足够正文，暂时无法基于资料内容生成学习汇报。"
            "请检查网络或更换资料来源。"
        )

    blocks = []
    total_chars = 0
    for idx, item in enumerate(readable, 1):
        snippet = item["preview"][:2600]
        total_chars += len(snippet)
        if total_chars > 12000:
            break
        blocks.append(
            f"【资料{idx}】{item.get('title')}\n"
            f"来源：{item.get('url')}\n"
            f"正文摘录：\n{snippet}"
        )

    prompt = f"""你已经替学习者拉取了以下参考资料正文。请基于这些正文做学习汇报，不要泛泛而谈，也不要只复述链接。

【学习主题】{project_topic}
【当前知识点】{node.title} ({node.code})
【知识点说明】{(node.description or "")[:1200]}

{chr(10).join(blocks)}

请用 Markdown 输出：
1. 这一批资料共同讲了什么，和当前知识点的关系
2. 学习者应该优先掌握的 3-5 个要点
3. 推荐学习顺序：先看哪份、带着什么问题看
4. 易错点/容易误解的地方
5. 一个 15-30 分钟可完成的小练习或自测任务

要求：像导师汇报一样直接、具体，控制在 900 字以内。"""
    return chat(
        prompt,
        system="你是严谨的学习研究助理，会基于已抓取资料正文做归纳和学习建议。",
        temperature=0.25,
        max_tokens=1600,
    )


def fetch_preview(url: str) -> str:
    """抓取 URL 内容作为预览 (简单版: 尝试请求并提取文本)。"""
    fetched = fetch_resource_content(url, max_chars=3000)
    if not fetched.get("ok"):
        return f"*预览失败: {fetched.get('error', '无法抓取')}*"
    return (
        f"## {fetched.get('title')}\n\n"
        f"来源: `{fetched.get('url')}`\n\n"
        f"{fetched.get('content', '')[:3000]}..."
    )


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
