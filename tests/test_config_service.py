import sys
from types import SimpleNamespace

import pytest

from learning_ext.config.service import (
    RuntimeConfigApplyError,
    _apply_runtime,
    config_status,
    save_config,
)


def test_config_write_is_atomic_and_never_returns_key(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    path.write_text("OTHER=value\nOPENAI_API_KEY=old\n", encoding="utf-8")
    monkeypatch.setattr("learning_ext.config.service._apply_runtime", lambda *args: None)

    result = save_config(
        base_url="http://127.0.0.1:1234/v1",
        api_key="sentinel-secret",
        chat_model="local-model",
        embedding_model="embed-model",
        path=path,
    )

    assert result["configured"] is True
    assert "api_key" not in result
    assert "sentinel-secret" not in str(result)
    assert config_status(path)["chat_model"] == "local-model"
    assert "OTHER=value" in path.read_text(encoding="utf-8")


def test_config_update_preserves_saved_key_and_exposes_non_secret_advanced_settings(
    tmp_path, monkeypatch
):
    path = tmp_path / ".env"
    path.write_text("OPENAI_API_KEY=sentinel-secret\n", encoding="utf-8")
    applied: dict[str, str] = {}

    def capture_runtime(base_url, api_key, chat_model, embedding_model):
        applied.update(
            base_url=base_url,
            api_key=api_key,
            chat_model=chat_model,
            embedding_model=embedding_model,
        )

    monkeypatch.setattr("learning_ext.config.service._apply_runtime", capture_runtime)

    result = save_config(
        provider="deepseek",
        base_url="https://api.deepseek.com/v1",
        api_key="",
        chat_model="deepseek-chat",
        embedding_model="text-embedding-3-small",
        path=path,
    )

    assert result == {
        "configured": True,
        "provider": "deepseek",
        "base_url": "https://api.deepseek.com/v1",
        "chat_model": "deepseek-chat",
        "embedding_model": "text-embedding-3-small",
        "chat_ready": True,
        "rag_ready": True,
    }
    assert "sentinel-secret" not in str(result)
    assert applied["api_key"] == "sentinel-secret"
    assert "OPENAI_API_KEY=sentinel-secret" in path.read_text(encoding="utf-8")


def test_runtime_update_failure_restores_previous_env(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    original = "OPENAI_API_KEY=sentinel-secret\nOPENAI_CHAT_MODEL=old-model\n"
    path.write_text(original, encoding="utf-8")
    monkeypatch.setattr(
        "learning_ext.config.service._apply_runtime",
        lambda *_args: (_ for _ in ()).throw(ValueError("manager rejected spec")),
    )

    with pytest.raises(RuntimeConfigApplyError):
        save_config(
            base_url="https://api.example.com/v1",
            api_key="",
            chat_model="new-model",
            embedding_model="new-embedding",
            path=path,
        )

    assert path.read_text(encoding="utf-8") == original


def test_runtime_hot_updates_the_real_embedding_manager(monkeypatch):
    class Manager:
        def __init__(self):
            self.calls = []

        def __contains__(self, _name):
            return False

        def add(self, name, *, spec, default):
            self.calls.append((name, spec, default))

    llms = Manager()
    embeddings = Manager()
    monkeypatch.setitem(sys.modules, "ktem.llms.manager", SimpleNamespace(llms=llms))
    monkeypatch.setitem(
        sys.modules,
        "ktem.embeddings.manager",
        SimpleNamespace(embedding_models_manager=embeddings),
    )
    monkeypatch.setattr("learning_ext.llm.client.invalidate_cache", lambda: None)

    _apply_runtime(
        "https://api.example.com/v1",
        "sentinel-secret",
        "chat-model",
        "embedding-model",
    )

    assert llms.calls[0][1]["model"] == "chat-model"
    assert embeddings.calls[0][1]["model"] == "embedding-model"
    assert embeddings.calls[0][1]["api_key"] == "sentinel-secret"
