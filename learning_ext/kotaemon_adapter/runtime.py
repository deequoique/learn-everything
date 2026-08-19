from __future__ import annotations

import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from learning_ext.kotaemon_adapter.chat import RecordingRetriever
from learning_ext.kotaemon_adapter.compatibility import (
    build_retrievers,
    load_headless_indices,
)
from learning_ext.kotaemon_adapter.library import FileCleanupIncomplete


class HeadlessKotaemonContext:
    def __init__(self) -> None:
        from ktem.components import reasonings
        from ktem.index import IndexManager
        from ktem.settings import (
            BaseSettingGroup,
            SettingGroup,
            SettingReasoningGroup,
        )
        from theflow.settings import settings
        from theflow.utils.modules import import_dotted_string

        self.default_settings = SettingGroup(
            application=BaseSettingGroup(settings=settings.SETTINGS_APP),
            reasoning=SettingReasoningGroup(settings=settings.SETTINGS_REASONING),
        )
        for dotted_path in getattr(settings, "KH_REASONINGS", []):
            reasoning_cls = import_dotted_string(dotted_path, safe=False)
            reasoning_id = reasoning_cls.get_info()["id"]
            reasonings[reasoning_id] = reasoning_cls
            self.default_settings.reasoning.options[reasoning_id] = BaseSettingGroup(
                settings=reasoning_cls().get_user_settings()
            )

        self.index_manager = IndexManager(self)
        load_headless_indices(self.index_manager)
        for index in self.index_manager.indices:
            self.default_settings.index.options[index.id] = BaseSettingGroup(
                settings=index.get_user_settings()
            )

        self.default_settings.reasoning.finalize()
        self.default_settings.index.finalize()


class KotaemonRuntimeAdapter:
    def __init__(self, context: Any | None = None) -> None:
        self.context = context or HeadlessKotaemonContext()

    @property
    def index_manager(self):
        return self.context.index_manager

    def settings(self) -> dict:
        return self.context.default_settings.flatten()

    def _index(self, index_id: str | None = None):
        indices = list(self.index_manager.indices)
        if index_id is None:
            if not indices:
                raise LookupError("RAG_NOT_CONFIGURED")
            return indices[0]
        for index in indices:
            if str(index.id) == str(index_id):
                return index
        raise LookupError("RAG_NOT_CONFIGURED")

    @staticmethod
    def _authorized_source_ids(index: Any, user_id: str, selected_ids: list[str] | None) -> list[str]:
        from ktem.db.engine import engine
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        Source = index._resources["Source"]
        statement = select(Source.id).where(Source.user == user_id)
        if selected_ids is not None:
            if not selected_ids:
                return []
            statement = statement.where(Source.id.in_(selected_ids))
        with Session(engine) as session:
            return list(session.execute(statement).scalars().all())

    def list_indices(self, _user_id: str) -> list[dict]:
        return [
            {
                "id": str(index.id),
                "name": index.name,
                "private": bool(index.config.get("private", False)),
            }
            for index in self.index_manager.indices
        ]

    def list_files(self, user_id: str, index_id: str | None, query: str) -> list[dict]:
        from ktem.db.engine import engine
        from sqlalchemy.orm import Session
        from sqlalchemy import select

        output: list[dict] = []
        for index in self.index_manager.indices:
            if index_id is not None and str(index.id) != str(index_id):
                continue
            Source = index._resources["Source"]
            statement = select(Source).where(Source.user == user_id)
            if query:
                escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                statement = statement.where(Source.name.ilike(f"%{escaped}%", escape="\\"))
            with Session(engine) as session:
                rows = session.execute(statement).scalars().all()
                output.extend(
                    {
                        "id": row.id,
                        "index_id": str(index.id),
                        "name": row.name,
                        "size": row.size,
                        "date_created": row.date_created.isoformat() if row.date_created else None,
                        "createdAt": row.date_created.isoformat() if row.date_created else None,
                    }
                    for row in rows
                )
        return output

    @staticmethod
    def _group_data(index: Any, group: Any) -> dict[str, Any]:
        data = group.data if isinstance(group.data, dict) else {}
        return {
            "id": str(group.id),
            "index_id": str(index.id),
            "name": str(group.name),
            "file_ids": [str(item) for item in data.get("files", [])],
            "date_created": group.date_created.isoformat() if group.date_created else None,
        }

    @staticmethod
    def _validate_group_files(session: Any, index: Any, user_id: str, file_ids: list[str]) -> list[str]:
        from sqlalchemy import select

        unique_ids = list(dict.fromkeys(str(item) for item in file_ids))
        if not unique_ids:
            return []
        Source = index._resources["Source"]
        owned = set(
            session.execute(
                select(Source.id).where(Source.user == user_id).where(Source.id.in_(unique_ids))
            ).scalars().all()
        )
        if owned != set(unique_ids):
            raise LookupError("NOT_FOUND")
        return unique_ids

    def list_groups(self, user_id: str, index_id: str | None = None) -> list[dict[str, Any]]:
        from ktem.db.engine import engine
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        output: list[dict[str, Any]] = []
        for index in self.index_manager.indices:
            if index_id is not None and str(index.id) != str(index_id):
                continue
            FileGroup = index._resources["FileGroup"]
            with Session(engine) as session:
                groups = session.execute(
                    select(FileGroup).where(FileGroup.user == user_id).order_by(FileGroup.date_created.desc())
                ).scalars().all()
                output.extend(self._group_data(index, group) for group in groups)
        return output

    def create_group(self, user_id: str, index_id: str, name: str, file_ids: list[str]) -> dict[str, Any]:
        from ktem.db.engine import engine
        from sqlalchemy import select
        from sqlalchemy.exc import IntegrityError
        from sqlalchemy.orm import Session

        index = self._index(index_id)
        FileGroup = index._resources["FileGroup"]
        with Session(engine) as session:
            if session.execute(
                select(FileGroup.id).where(FileGroup.user == user_id).where(FileGroup.name == name)
            ).first():
                raise FileExistsError(name)
            owned_ids = self._validate_group_files(session, index, user_id, file_ids)
            group = FileGroup(name=name, user=user_id, data={"files": owned_ids})
            session.add(group)
            try:
                session.commit()
            except IntegrityError as exc:
                session.rollback()
                raise FileExistsError(name) from exc
            session.refresh(group)
            return self._group_data(index, group)

    def update_group(
        self,
        user_id: str,
        group_id: str,
        *,
        name: str | None,
        file_ids: list[str] | None,
    ) -> dict[str, Any] | None:
        from ktem.db.engine import engine
        from sqlalchemy import select
        from sqlalchemy.exc import IntegrityError
        from sqlalchemy.orm import Session

        for index in self.index_manager.indices:
            FileGroup = index._resources["FileGroup"]
            with Session(engine) as session:
                group = session.execute(
                    select(FileGroup).where(FileGroup.id == group_id).where(FileGroup.user == user_id)
                ).scalar_one_or_none()
                if group is None:
                    continue
                if name is not None:
                    group.name = name
                if file_ids is not None:
                    group.data = {
                        **(group.data if isinstance(group.data, dict) else {}),
                        "files": self._validate_group_files(session, index, user_id, file_ids),
                    }
                session.add(group)
                try:
                    session.commit()
                except IntegrityError as exc:
                    session.rollback()
                    raise FileExistsError(name or group.name) from exc
                session.refresh(group)
                return self._group_data(index, group)
        return None

    def delete_group(self, user_id: str, group_id: str) -> bool:
        from ktem.db.engine import engine
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        for index in self.index_manager.indices:
            FileGroup = index._resources["FileGroup"]
            with Session(engine) as session:
                group = session.execute(
                    select(FileGroup).where(FileGroup.id == group_id).where(FileGroup.user == user_id)
                ).scalar_one_or_none()
                if group is None:
                    continue
                session.delete(group)
                session.commit()
                return True
        return False

    def delete_file(self, user_id: str, file_id: str) -> bool:
        from ktem.db.engine import engine
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        for index in self.index_manager.indices:
            Source = index._resources["Source"]
            Index = index._resources["Index"]
            with Session(engine) as session:
                statement = select(Source).where(Source.id == file_id).where(Source.user == user_id)
                source = session.execute(statement).scalar_one_or_none()
                if source is None:
                    continue
                stored_name = source.path
                relations = session.execute(select(Index).where(Index.source_id == file_id)).scalars().all()
                FileGroup = index._resources["FileGroup"]
                groups = session.execute(
                    select(FileGroup).where(FileGroup.user == user_id)
                ).scalars().all()
                for group in groups:
                    data = group.data if isinstance(group.data, dict) else {}
                    files = [str(item) for item in data.get("files", [])]
                    if file_id in files:
                        group.data = {**data, "files": [item for item in files if item != file_id]}
                        session.add(group)
                vector_ids = [row.target_id for row in relations if row.relation_type == "vector"]
                document_ids = [row.target_id for row in relations if row.relation_type == "document"]
                for row in relations:
                    session.delete(row)
                session.delete(source)
                session.commit()
            cleanup_failed = False
            if vector_ids:
                try:
                    index._vs.delete(vector_ids)
                except Exception:
                    cleanup_failed = True
            if document_ids:
                try:
                    index._docstore.delete(document_ids)
                except Exception:
                    cleanup_failed = True
            with Session(engine) as session:
                still_used = session.execute(select(Source.id).where(Source.path == stored_name)).first()
            if not still_used:
                stored_path = (Path(index._fs_path) / stored_name).resolve()
                storage_root = Path(index._fs_path).resolve()
                if stored_path.is_relative_to(storage_root) and stored_path.is_file():
                    try:
                        stored_path.unlink()
                    except OSError:
                        cleanup_failed = True
            if cleanup_failed:
                raise FileCleanupIncomplete(file_id)
            return True
        return False

    def download_file(self, user_id: str, file_id: str) -> tuple[Path, str] | None:
        from ktem.db.engine import engine
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        for index in self.index_manager.indices:
            Source = index._resources["Source"]
            with Session(engine) as session:
                source = session.execute(
                    select(Source).where(Source.id == file_id).where(Source.user == user_id)
                ).scalar_one_or_none()
                if source is None:
                    continue
                storage_root = Path(index._fs_path).resolve()
                stored_path = (storage_root / str(source.path)).resolve()
                if not stored_path.is_relative_to(storage_root) or not stored_path.is_file():
                    return None
                return stored_path, Path(str(source.name)).name
        return None

    def stream_chat(
        self,
        *,
        user_id: str,
        message: str,
        conversation_id: str,
        history: list[tuple[str, str]],
        file_ids: list[str] | None,
        cancel: threading.Event,
    ) -> Iterator[dict[str, Any]]:
        from ktem.components import reasonings
        from kotaemon.base import Document

        settings = dict(self.settings())
        settings["reasoning.options.simple.create_mindmap"] = False
        settings["reasoning.options.simple.create_citation_viz"] = False
        settings["reasoning.options.simple.highlight_citation"] = "highlight"
        requested = None if file_ids is None else list(dict.fromkeys(file_ids))
        recorders: list[RecordingRetriever] = []
        for index in self.index_manager.indices:
            authorized = self._authorized_source_ids(index, user_id, requested)
            if requested is not None:
                requested = [item for item in requested if item not in authorized]
            for retriever in build_retrievers(index, settings, user_id, authorized):
                recorder = RecordingRetriever(retriever)
                recorders.append(recorder)
        if requested:
            raise LookupError("NOT_FOUND")
        reasoning_cls = reasonings.get("simple")
        if reasoning_cls is None:
            raise RuntimeError("UNSUPPORTED_REASONING")
        pipeline = reasoning_cls.get_pipeline(
            settings,
            {"app": {"regen": False}, "pipeline": {}},
            recorders,
        )
        answer: list[str] = []
        for response in pipeline.stream(message, conversation_id, history):
            if cancel.is_set():
                return
            if not isinstance(response, Document) or response.channel != "chat":
                continue
            if response.content is None:
                answer.clear()
                continue
            text = str(response.content)
            if text:
                answer.append(text)
                yield {"type": "delta", "data": {"text": text}}
        if not "".join(answer).strip():
            raise RuntimeError("EMPTY_ANSWER")
        for recorder in recorders:
            for citation in recorder.citations():
                if cancel.is_set():
                    return
                yield {"type": "citation", "data": citation}

    @staticmethod
    def _progress_phase(message: str) -> str:
        lowered = message.lower()
        if "embedding" in lowered:
            return "embedding"
        if "chunk" in lowered or "processed" in lowered:
            return "chunking"
        if "convert" in lowered:
            return "extracting"
        if "finish" in lowered:
            return "finalizing"
        return "queued"

    def stream_index_file(
        self,
        *,
        user_id: str,
        index_id: str | None,
        file_path: Path,
        cancel: threading.Event,
    ) -> Iterator[dict[str, Any]]:
        index = self._index(index_id)
        settings = dict(self.settings())
        settings[f"index.options.{index.id}.quick_index_mode"] = False
        pipeline = index.get_indexing_pipeline(settings, user_id)
        pipeline.run_embedding_in_thread = False
        single = pipeline.route(file_path)
        existing_id = single.get_id_if_exists(file_path)
        if existing_id is not None:
            raise FileExistsError(file_path.name)
        source_id: str | None = None
        succeeded = False
        output = iter(pipeline.stream(file_path, reindex=False))
        try:
            while True:
                if cancel.is_set():
                    return
                try:
                    response = next(output)
                except StopIteration as stop:
                    file_ids, errors, _docs = stop.value
                    source_id = next((item for item in file_ids if item), source_id)
                    if errors and any(errors):
                        raise RuntimeError("FILE_INDEX_FAILED")
                    if source_id is None:
                        raise RuntimeError("FILE_INDEX_FAILED")
                    succeeded = True
                    yield {
                        "type": "result",
                        "data": {"kind": "library-index", "payload": {"file_id": source_id, "name": file_path.name}},
                    }
                    return
                content = response.content
                if response.channel == "debug":
                    message = str(content or "")
                    yield {
                        "type": "progress",
                        "data": {"phase": self._progress_phase(message), "message": "正在处理资料", "current": 1, "total": 1},
                    }
                elif response.channel == "index" and isinstance(content, dict):
                    if content.get("status") == "failed":
                        raise RuntimeError("FILE_INDEX_FAILED")
                    yield {
                        "type": "progress",
                        "data": {"phase": "finalizing", "message": "正在完成索引", "current": 1, "total": 1},
                    }
                if source_id is None:
                    source_id = single.get_id_if_exists(file_path)
        finally:
            close = getattr(output, "close", None)
            if callable(close):
                close()
            if not succeeded:
                source_id = source_id or single.get_id_if_exists(file_path)
                if source_id is not None:
                    self.delete_file(user_id, source_id)
