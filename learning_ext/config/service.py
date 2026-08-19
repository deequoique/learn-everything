from __future__ import annotations

import os
import tempfile
import threading
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[2] / "kotaemon" / ".env"
_WRITE_LOCK = threading.Lock()
_KEYS = {
    "provider": "LE_MODEL_PROVIDER",
    "base_url": "OPENAI_API_BASE",
    "api_key": "OPENAI_API_KEY",
    "chat_model": "OPENAI_CHAT_MODEL",
    "embedding_model": "OPENAI_EMBEDDINGS_MODEL",
}


class ApiKeyRequired(ValueError):
    pass


class RuntimeConfigApplyError(RuntimeError):
    pass


def _read(path: Path = ENV_FILE) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def config_status(path: Path = ENV_FILE) -> dict:
    values = _read(path)
    configured = bool(get_saved_api_key(path))
    return {
        "configured": configured,
        "provider": values.get("LE_MODEL_PROVIDER", "openai-compatible"),
        "base_url": values.get("OPENAI_API_BASE", ""),
        "chat_model": values.get("OPENAI_CHAT_MODEL", ""),
        "embedding_model": values.get("OPENAI_EMBEDDINGS_MODEL", ""),
        "chat_ready": configured and bool(values.get("OPENAI_CHAT_MODEL")),
        "rag_ready": configured and bool(values.get("OPENAI_EMBEDDINGS_MODEL")),
    }


def get_saved_api_key(path: Path = ENV_FILE) -> str:
    key = _read(path).get(_KEYS["api_key"], "")
    if not key or "YOUR" in key or "请在UI" in key:
        return ""
    return key


def _atomic_write(content: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _atomic_update(updates: dict[str, str], path: Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    env_updates = {_KEYS[key]: value for key, value in updates.items() if key in _KEYS}
    written: set[str] = set()
    output: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line else ""
        if key in env_updates:
            output.append(f"{key}={env_updates[key]}")
            written.add(key)
        else:
            output.append(line)
    output.extend(f"{key}={value}" for key, value in env_updates.items() if key not in written)
    _atomic_write("\n".join(output) + "\n", path)


def _apply_runtime(base_url: str, api_key: str, chat_model: str, embedding_model: str) -> None:
    from learning_ext.llm.client import invalidate_cache

    invalidate_cache()
    try:
        from ktem.llms.manager import llms

        spec = {
            "__type__": "kotaemon.llms.ChatOpenAI",
            "temperature": 0.3,
            "base_url": base_url,
            "api_key": api_key,
            "model": chat_model,
            "timeout": 60,
        }
        (llms.update if "openai" in llms else llms.add)("openai", spec=spec, default=True)
    except ImportError:
        pass
    if embedding_model:
        try:
            from ktem.embeddings.manager import embedding_models_manager

            spec = {
                "__type__": "kotaemon.embeddings.OpenAIEmbeddings",
                "base_url": base_url,
                "api_key": api_key,
                "model": embedding_model,
                "timeout": 30,
            }
            manager = embedding_models_manager
            (manager.update if "openai" in manager else manager.add)("openai", spec=spec, default=True)
        except ImportError:
            pass


def save_config(
    *,
    base_url: str,
    api_key: str,
    chat_model: str,
    embedding_model: str,
    provider: str = "openai-compatible",
    path: Path = ENV_FILE,
) -> dict:
    with _WRITE_LOCK:
        saved_key = get_saved_api_key(path)
        effective_key = api_key or saved_key
        if not effective_key:
            raise ApiKeyRequired("API_KEY_REQUIRED")
        previous = path.read_text(encoding="utf-8") if path.exists() else None
        _atomic_update(
            {
                "provider": provider,
                "base_url": base_url,
                "api_key": effective_key,
                "chat_model": chat_model,
                "embedding_model": embedding_model,
            },
            path,
        )
        try:
            _apply_runtime(base_url, effective_key, chat_model, embedding_model)
        except Exception as exc:
            if previous is None:
                path.unlink(missing_ok=True)
            else:
                _atomic_write(previous, path)
            from learning_ext.llm.client import invalidate_cache

            invalidate_cache()
            raise RuntimeConfigApplyError("CONFIG_APPLY_FAILED") from exc
    return config_status(path)
