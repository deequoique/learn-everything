from types import SimpleNamespace
import threading

import pytest

from learning_ext.kotaemon_adapter.chat import RecordingRetriever
from learning_ext.kotaemon_adapter.compatibility import (
    KotaemonCompatibilityError,
    build_retrievers,
    load_headless_indices,
)
from learning_ext.kotaemon_adapter.library import FileCleanupIncomplete, validate_public_url
from learning_ext.kotaemon_adapter.runtime import KotaemonRuntimeAdapter


def _runtime_index_models(engine, tmp_path):
    from datetime import datetime
    import uuid

    from sqlalchemy import JSON, Column, DateTime, Integer, String
    from sqlalchemy.ext.mutable import MutableDict
    from sqlalchemy.orm import declarative_base

    Base = declarative_base()

    class Source(Base):
        __tablename__ = "qa_runtime_source"
        id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
        name = Column(String)
        path = Column(String)
        size = Column(Integer, default=0)
        user = Column(String)
        date_created = Column(DateTime, default=datetime.now)

    class IndexRow(Base):
        __tablename__ = "qa_runtime_index"
        id = Column(Integer, primary_key=True, autoincrement=True)
        source_id = Column(String)
        target_id = Column(String)
        relation_type = Column(String)

    class FileGroup(Base):
        __tablename__ = "qa_runtime_group"
        id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
        name = Column(String)
        user = Column(String)
        date_created = Column(DateTime, default=datetime.now)
        data = Column(MutableDict.as_mutable(JSON), default={"files": []})

    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    class Store:
        def __init__(self):
            self.deleted = []

        def delete(self, ids):
            self.deleted.extend(ids)

    vector = Store()
    documents = Store()
    index = SimpleNamespace(
        id="qa",
        name="QA",
        config={"private": True},
        _resources={"Source": Source, "Index": IndexRow, "FileGroup": FileGroup},
        _vs=vector,
        _docstore=documents,
        _fs_path=tmp_path,
    )
    app = SimpleNamespace(
        index_manager=SimpleNamespace(indices=[index]),
        default_settings=SimpleNamespace(flatten=lambda: {}),
    )
    return KotaemonRuntimeAdapter(app), index, Source, IndexRow, FileGroup, vector, documents


def test_recording_retriever_deduplicates_and_strips_html():
    docs = [
        SimpleNamespace(doc_id="one", metadata={"file_id": "f", "file_name": "<b>Title</b>"}, text="<script>x</script> useful"),
        SimpleNamespace(doc_id="one", metadata={}, text="duplicate"),
    ]
    recorder = RecordingRetriever(lambda: docs)
    recorder()

    citations = recorder.citations()

    assert len(citations) == 1
    assert "<" not in citations[0]["title"]
    assert "<" not in citations[0]["snippet"]


def test_private_compatibility_seam_fails_with_actionable_error():
    with pytest.raises(KotaemonCompatibilityError, match="contract changed"):
        build_retrievers(SimpleNamespace(id=1), {}, "default", [])


def test_headless_index_loader_skips_kotaemon_ui_setup(monkeypatch, _db_engine):
    import ktem.index.models as index_models
    from sqlmodel import Session, delete

    class HeadlessIndex:
        def __init__(self, app, id, name, config):
            self.app = app
            self.id = id
            self.name = name
            self.config = config
            self.calls = []

        def _setup_resources(self):
            self.calls.append("resources")

        def _setup_indexing_cls(self):
            self.calls.append("indexing")

        def _setup_retriever_cls(self):
            self.calls.append("retriever")

        def _setup_file_index_ui_cls(self):
            raise AssertionError("headless startup must not load index UI")

        def _setup_file_selector_ui_cls(self):
            raise AssertionError("headless startup must not load selector UI")

    manager = SimpleNamespace(
        _app=object(),
        _indices=[],
        load_index_types=lambda: None,
        exists=lambda **_kwargs: True,
        build_index=lambda **_kwargs: None,
    )
    index_models.Index.metadata.create_all(_db_engine)
    with Session(_db_engine) as session:
        session.add(
            index_models.Index(
                name="Headless QA",
                index_type="test.HeadlessIndex",
                config={},
            )
        )
        session.commit()
    monkeypatch.setattr("ktem.db.engine.engine", _db_engine)
    monkeypatch.setattr(
        "theflow.utils.modules.import_dotted_string",
        lambda *_args, **_kwargs: HeadlessIndex,
    )

    try:
        load_headless_indices(manager)
        assert manager._indices[0].calls == ["resources", "indexing", "retriever"]
    finally:
        with Session(_db_engine) as session:
            session.exec(
                delete(index_models.Index).where(
                    index_models.Index.name == "Headless QA"
                )
            )
            session.commit()


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://user:password@example.com",
        "http://127.0.0.1/private",
        "http://[::1]/private",
    ],
)
def test_url_validator_rejects_ssrf_targets(url):
    with pytest.raises(ValueError, match="URL_NOT_ALLOWED"):
        validate_public_url(url)


def test_headless_chat_pipeline_records_real_retrieval_before_rendering(monkeypatch):
    from kotaemon.base import Document
    from ktem.components import reasonings

    retrieved = SimpleNamespace(
        doc_id="doc-1",
        metadata={"file_id": "file-1", "file_name": "<b>资料</b>", "page_label": "2"},
        text="<script>bad()</script>可信原文",
    )

    class Retriever:
        def __call__(self, **kwargs):
            return [retrieved]

        def generate_relevant_scores(self, _message, docs):
            return docs

    class Pipeline:
        def __init__(self, retrievers):
            self.retrievers = retrievers

        def stream(self, message, conversation_id, history):
            assert message == "问题"
            assert conversation_id == "conversation"
            self.retrievers[0](text=message)
            yield Document(channel="info", content="<script>rendered()</script>")
            yield Document(channel="chat", content="回答")

    class Reasoning:
        @staticmethod
        def get_pipeline(settings, state, retrievers):
            return Pipeline(retrievers)

    index = SimpleNamespace(id=1)
    app = SimpleNamespace(
        index_manager=SimpleNamespace(indices=[index]),
        default_settings=SimpleNamespace(
            flatten=lambda: {
                "reasoning.options.simple.highlight_citation": "highlight",
                "reasoning.options.simple.create_mindmap": False,
                "reasoning.options.simple.create_citation_viz": False,
            }
        ),
    )
    runtime = KotaemonRuntimeAdapter(app)
    monkeypatch.setattr(runtime, "_authorized_source_ids", lambda *args: ["file-1"])
    monkeypatch.setattr("learning_ext.kotaemon_adapter.runtime.build_retrievers", lambda *args: [Retriever()])
    monkeypatch.setitem(reasonings, "simple", Reasoning)

    events = list(
        runtime.stream_chat(
            user_id="default",
            message="问题",
            conversation_id="conversation",
            history=[],
            file_ids=["file-1"],
            cancel=threading.Event(),
        )
    )

    assert [event["type"] for event in events] == ["delta", "citation"]
    citation = events[1]["data"]
    assert citation["file_id"] == "file-1"
    assert "<" not in citation["title"]
    assert "<" not in citation["snippet"]


def test_failed_indexing_compensates_new_partial_artifact(monkeypatch, tmp_path):
    class SinglePipeline:
        run_embedding_in_thread = True

        def __init__(self):
            self.lookups = 0

        def get_id_if_exists(self, _path):
            self.lookups += 1
            return None if self.lookups == 1 else "partial-id"

    single = SinglePipeline()

    class IndexingPipeline:
        run_embedding_in_thread = True

        def route(self, _path):
            return single

        def stream(self, _path, reindex=False):
            assert reindex is False
            yield SimpleNamespace(channel="debug", content="Converting lesson.txt to text")
            raise RuntimeError("parser failed")

    indexing = IndexingPipeline()
    index = SimpleNamespace(id=1, get_indexing_pipeline=lambda settings, user_id: indexing)
    app = SimpleNamespace(
        index_manager=SimpleNamespace(indices=[index]),
        default_settings=SimpleNamespace(flatten=lambda: {}),
    )
    runtime = KotaemonRuntimeAdapter(app)
    deleted: list[tuple[str, str]] = []
    monkeypatch.setattr(runtime, "delete_file", lambda user_id, file_id: deleted.append((user_id, file_id)) or True)
    path = tmp_path / "lesson.txt"
    path.write_text("content", encoding="utf-8")

    with pytest.raises(RuntimeError, match="parser failed"):
        list(
            runtime.stream_index_file(
                user_id="default",
                index_id="1",
                file_path=path,
                cancel=threading.Event(),
            )
        )

    assert indexing.run_embedding_in_thread is False
    assert deleted == [("default", "partial-id")]


def test_group_membership_and_cleanup_are_ownership_scoped(monkeypatch, _db_engine, tmp_path):
    from sqlalchemy.orm import Session

    import ktem.db.engine as db_engine

    monkeypatch.setattr(db_engine, "engine", _db_engine)
    runtime, _index, Source, IndexRow, FileGroup, vector, documents = _runtime_index_models(_db_engine, tmp_path)
    stored = tmp_path / "stored.txt"
    stored.write_text("content", encoding="utf-8")
    with Session(_db_engine) as session:
        session.add_all(
            [
                Source(id="owned", name="owned.txt", path=stored.name, size=7, user="default"),
                Source(id="foreign", name="foreign.txt", path="foreign.txt", size=1, user="other"),
                IndexRow(source_id="owned", target_id="vector-1", relation_type="vector"),
                IndexRow(source_id="owned", target_id="doc-1", relation_type="document"),
                FileGroup(id="group-1", name="核心", user="default", data={"files": ["owned"]}),
            ]
        )
        session.commit()

    with pytest.raises(LookupError, match="NOT_FOUND"):
        runtime.create_group("default", "qa", "越权", ["foreign"])
    created = runtime.create_group("default", "qa", "新分组", ["owned"])
    assert created["file_ids"] == ["owned"]
    assert runtime.delete_file("other", "owned") is False
    assert runtime.delete_file("default", "owned") is True

    with Session(_db_engine) as session:
        assert session.get(Source, "owned") is None
        assert session.get(Source, "foreign") is not None
        assert session.query(IndexRow).filter_by(source_id="owned").count() == 0
        groups = session.query(FileGroup).filter_by(user="default").all()
        assert all("owned" not in group.data["files"] for group in groups)
    assert vector.deleted == ["vector-1"]
    assert documents.deleted == ["doc-1"]
    assert not stored.exists()


def test_cleanup_continues_after_one_store_fails(monkeypatch, _db_engine, tmp_path):
    from sqlalchemy.orm import Session

    import ktem.db.engine as db_engine

    monkeypatch.setattr(db_engine, "engine", _db_engine)
    runtime, _index, Source, IndexRow, _FileGroup, vector, documents = _runtime_index_models(_db_engine, tmp_path)
    stored = tmp_path / "partial.txt"
    stored.write_text("partial", encoding="utf-8")
    with Session(_db_engine) as session:
        session.add(Source(id="partial", name="partial.txt", path=stored.name, size=7, user="default"))
        session.add_all(
            [
                IndexRow(source_id="partial", target_id="vector-bad", relation_type="vector"),
                IndexRow(source_id="partial", target_id="doc-good", relation_type="document"),
            ]
        )
        session.commit()

    def fail_vector(_ids):
        raise RuntimeError("vector unavailable")

    monkeypatch.setattr(vector, "delete", fail_vector)
    with pytest.raises(FileCleanupIncomplete):
        runtime.delete_file("default", "partial")

    assert documents.deleted == ["doc-good"]
    assert not stored.exists()
