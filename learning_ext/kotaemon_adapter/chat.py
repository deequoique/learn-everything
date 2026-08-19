from __future__ import annotations

import re
from typing import Any

from kotaemon.base import BaseComponent, Param


def plain_text(value: Any, limit: int = 800) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()[:limit]


class RecordingRetriever(BaseComponent):
    delegate: Any = Param(help="The headless Kotaemon retriever being recorded")
    documents: list[Any] = Param(default_callback=lambda _: [])
    allow_extra = True

    def __init__(self, delegate: Any) -> None:
        super().__init__(delegate=delegate)

    def __call__(self, *args, **kwargs):
        result = self.delegate(*args, **kwargs)
        self.documents.extend(result or [])
        return result

    def run(self, *args, **kwargs):
        return self(*args, **kwargs)

    def generate_relevant_scores(self, *args, **kwargs):
        return self.delegate.generate_relevant_scores(*args, **kwargs)

    def citations(self) -> list[dict]:
        output: list[dict] = []
        seen: set[str] = set()
        for doc in self.documents:
            metadata = getattr(doc, "metadata", {}) or {}
            doc_id = str(getattr(doc, "doc_id", "") or metadata.get("doc_id") or "")
            if not doc_id or doc_id in seen:
                continue
            seen.add(doc_id)
            output.append(
                {
                    "citation_id": doc_id,
                    "file_id": str(metadata.get("file_id") or ""),
                    "title": plain_text(metadata.get("file_name") or "资料"),
                    "page": plain_text(metadata.get("page_label"), 80) or None,
                    "snippet": plain_text(getattr(doc, "text", "") or getattr(doc, "content", "")),
                    "score": getattr(doc, "score", None),
                }
            )
        return output
