"""学习 Agent 的 React/FastAPI 启动入口。"""

import os
import sys
import sysconfig
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent
_TIKTOKEN_CACHE_DIR = _PROJECT_ROOT / "kotaemon" / "ktem_app_data" / "tiktoken_cache"
os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(_TIKTOKEN_CACHE_DIR))


def _configure_tiktoken_fallback() -> None:
    try:
        import tiktoken

        def install_fallback() -> None:
            fallback = tiktoken.Encoding(
                name="learn-everything-byte-fallback",
                pat_str=r"[\s\S]",
                mergeable_ranks={bytes([value]): value for value in range(256)},
                special_tokens={},
            )
            tiktoken.encoding_for_model = lambda _model: fallback

        if not _TIKTOKEN_CACHE_DIR.is_dir() or not any(_TIKTOKEN_CACHE_DIR.iterdir()):
            install_fallback()
            return
        try:
            tiktoken.encoding_for_model("gpt-3.5-turbo")
        except Exception:
            install_fallback()
    except Exception:
        pass


_configure_tiktoken_fallback()

# Kotaemon 底座实例化 cohere/voyage 等 LLM 时会直接读 os.environ 校验 key，
# 本地若未配置这些服务，注入占位值避免启动崩溃 (实际不使用这些服务)
os.environ.setdefault("COHERE_API_KEY", "placeholder-key-1234567890")
os.environ.setdefault("VOYAGE_API_KEY", "placeholder-key-1234567890")
os.environ.setdefault("MISTRAL_API_KEY", "placeholder-key-1234567890")
os.environ.setdefault("GOOGLE_API_KEY", "placeholder-key-1234567890")

# 离线模式：避免启动时访问 huggingface.co 超时 (国内网络)；
# 需要下载模型时用户可手动设这两个变量为 0
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
# NLTK 数据路径：指向 llama_index 自带的 nltk_cache，避免联网下载 stopwords/punkt
_SITE_PACKAGES = Path(sysconfig.get_paths().get("purelib", ""))
_NLTK_CACHE = _SITE_PACKAGES / "llama_index" / "core" / "_static" / "nltk_cache"
if _NLTK_CACHE.is_dir():
    os.environ["NLTK_DATA"] = str(_NLTK_CACHE)

# 确保 learning_ext 在 import 路径中
_HERE = str(_PROJECT_ROOT)
sys.path.insert(0, _HERE)

# Kotaemon 的 control.py 用 `import flowsettings`，要求 kotaemon 目录在 sys.path
_KOTAEMON_DIR = os.path.join(_HERE, "kotaemon")
sys.path.insert(0, _KOTAEMON_DIR)

def create_production_app(runtime=None):
    from learning_ext.api import create_app
    from learning_ext.kotaemon_adapter import KotaemonRuntimeAdapter

    return create_app(runtime=runtime or KotaemonRuntimeAdapter())


def main() -> None:
    import uvicorn

    host = os.getenv("LE_SERVER_HOST", "127.0.0.1")
    port = int(os.getenv("LE_SERVER_PORT", "7860"))
    uvicorn.run(create_production_app(), host=host, port=port, workers=1)


if __name__ == "__main__":
    main()
