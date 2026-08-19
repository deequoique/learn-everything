from __future__ import annotations

from typing import Any


class KotaemonCompatibilityError(RuntimeError):
    pass


def load_headless_indices(index_manager: Any) -> None:
    from ktem.db.engine import engine
    from ktem.index.models import Index
    from sqlmodel import Session, select
    from theflow.settings import settings
    from theflow.utils.modules import import_dotted_string

    index_manager.load_index_types()
    for definition in settings.KH_INDICES:
        if not index_manager.exists(name=definition["name"]):
            index_manager.build_index(**definition)

    with Session(engine) as session:
        definitions = list(session.exec(select(Index)).all())

    for definition in definitions:
        index_cls = import_dotted_string(definition.index_type, safe=False)
        index = index_cls(
            app=index_manager._app,
            id=definition.id,
            name=definition.name,
            config=definition.config,
        )
        required = ("_setup_resources", "_setup_indexing_cls", "_setup_retriever_cls")
        missing = [name for name in required if not hasattr(index, name)]
        if missing:
            raise KotaemonCompatibilityError(
                f"Kotaemon index contract changed: {', '.join(missing)}"
            )
        index._setup_resources()
        index._setup_indexing_cls()
        index._setup_retriever_cls()
        index_manager._indices.append(index)


def build_retrievers(
    index: Any,
    settings: dict,
    user_id: str,
    selected_ids: list[str] | None,
) -> list[Any]:
    required = ("_retriever_pipeline_cls", "_resources", "_vs", "_docstore", "_fs_path")
    missing = [name for name in required if not hasattr(index, name)]
    if missing:
        raise KotaemonCompatibilityError(f"Kotaemon index contract changed: {', '.join(missing)}")
    prefix = f"index.options.{index.id}."
    stripped = {key[len(prefix) :]: value for key, value in settings.items() if key.startswith(prefix)}
    retrievers = []
    for retriever_cls in index._retriever_pipeline_cls:
        retriever = retriever_cls.get_pipeline(stripped, index.config, selected_ids)
        if retriever is None:
            continue
        retriever.Source = index._resources["Source"]
        retriever.Index = index._resources["Index"]
        retriever.VS = index._vs
        retriever.DS = index._docstore
        retriever.FSPath = index._fs_path
        retriever.user_id = user_id
        retrievers.append(retriever)
    return retrievers
