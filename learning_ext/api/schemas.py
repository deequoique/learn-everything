from __future__ import annotations

from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ProjectGenerateRequest(StrictModel):
    topic: str = Field(min_length=1, max_length=300)
    background: str = Field(default="", max_length=2000)
    goal: str = Field(default="", max_length=2000)
    weekly_hours: float = Field(default=10, ge=0.5, le=168)
    save: bool = True


class ProjectRefineRequest(StrictModel):
    instruction: str = Field(min_length=1, max_length=4000)


class ProjectAuditRequest(StrictModel):
    apply: bool = False


class ProjectImportRequest(StrictModel):
    payload: str = Field(min_length=2, max_length=5_000_000)


class NodeStatusRequest(StrictModel):
    status: Literal["pending", "learning", "mastered", "weak", "skipped"]


class NoteRequest(StrictModel):
    content: str = Field(default="", max_length=100_000, validation_alias=AliasChoices("content", "note"))
    selection: str = Field(default="", max_length=1000)


class ReviewRequest(StrictModel):
    rating: Literal[1, 2, 3, 4]


class ChatRequest(StrictModel):
    message: str = Field(min_length=1, max_length=20_000)
    conversation_id: str | None = None
    file_ids: list[str] | None = Field(default=None, max_length=100)
    project_id: int | None = Field(default=None, ge=1)
    node_id: int | None = Field(default=None, ge=1)


class ConversationCreateRequest(StrictModel):
    title: str = Field(default="新对话", min_length=1, max_length=120)


class ConversationUpdateRequest(StrictModel):
    title: str = Field(min_length=1, max_length=120)


class ConfigRequest(StrictModel):
    provider: str = Field(default="openai-compatible", max_length=80)
    api_key: str = Field(default="", max_length=1000, validation_alias=AliasChoices("api_key", "apiKey"))
    base_url: str = Field(default="", max_length=2000, validation_alias=AliasChoices("base_url", "baseUrl"))
    chat_model: str = Field(default="", max_length=300, validation_alias=AliasChoices("chat_model", "model"))
    embedding_model: str = Field(default="", max_length=300, validation_alias=AliasChoices("embedding_model", "embeddingModel"))


class LibraryIndexRequest(StrictModel):
    index_id: str | None = None
    url: str | None = Field(default=None, max_length=4000)
    file_name: str | None = Field(default=None, max_length=255)
    size: int | None = Field(default=None, ge=0, le=200 * 1024 * 1024)


class LibraryGroupCreateRequest(StrictModel):
    index_id: str
    name: str = Field(min_length=1, max_length=120)
    file_ids: list[str] = Field(default_factory=list, max_length=200)


class LibraryGroupUpdateRequest(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    file_ids: list[str] | None = Field(default=None, max_length=200)
