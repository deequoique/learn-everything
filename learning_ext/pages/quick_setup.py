"""极简模型配置页 - 替代 Kotaemon 复杂的 Resources 页。

用户只需：选服务商 → 填 API Key → 点保存。
后台自动填好 base_url / 模型名，并即时更新运行时 LLM 池。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import gradio as gr
from ktem.app import BasePage

logger = logging.getLogger(__name__)

# 预设服务商配置 (base_url, 对话模型, 向量模型, 备注)
PROVIDERS = {
    "DeepSeek (推荐，便宜好用)": {
        "base_url": "https://api.deepseek.com/v1",
        "chat_model": "deepseek-chat",
        "embed_model": "",  # DeepSeek 无 embedding，留空走本地
        "note": "DeepSeek 只有对话模型，无向量模型。配置后学习路线/测验/对话立即可用。上传资料问答(RAG)需另配向量模型。",
        "key_url": "https://platform.deepseek.com/api_keys",
    },
    "智谱 GLM (有免费额度)": {
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "chat_model": "glm-4-flash",
        "embed_model": "embedding-3",
        "note": "智谱有完整对话+向量模型，免费额度充足，RAG 全功能可用。",
        "key_url": "https://bigmodel.cn/console/usercenter/apikeys",
    },
    "通义千问 (阿里云)": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "chat_model": "qwen-plus",
        "embed_model": "text-embedding-v3",
        "note": "通义千问有完整对话+向量模型。",
        "key_url": "https://dashscope.console.aliyun.com/apiKey",
    },
    "OpenAI (官方)": {
        "base_url": "https://api.openai.com/v1",
        "chat_model": "gpt-4o-mini",
        "embed_model": "text-embedding-3-large",
        "note": "效果最好但需海外网络，成本较高。",
        "key_url": "https://platform.openai.com/api-keys",
    },
    "自定义 (OpenAI 兼容接口)": {
        "base_url": "",
        "chat_model": "",
        "embed_model": "",
        "note": "填入任意 OpenAI 兼容的接口。",
        "key_url": "",
    },
}

# .env 文件路径
ENV_FILE = Path(__file__).resolve().parent.parent.parent / "kotaemon" / ".env"


def _read_env() -> dict:
    """读取当前 .env 里的 LLM 配置"""
    data = {
        "base_url": "",
        "api_key": "",
        "chat_model": "",
        "embed_model": "",
    }
    if not ENV_FILE.exists():
        return data
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("OPENAI_API_BASE="):
            data["base_url"] = line.split("=", 1)[1].strip()
        elif line.startswith("OPENAI_API_KEY="):
            val = line.split("=", 1)[1].strip()
            # 过滤占位符
            if val and "请在UI" not in val and "YOUR" not in val:
                data["api_key"] = val
        elif line.startswith("OPENAI_CHAT_MODEL="):
            data["chat_model"] = line.split("=", 1)[1].strip()
        elif line.startswith("OPENAI_EMBEDDINGS_MODEL="):
            data["embed_model"] = line.split("=", 1)[1].strip()
    return data


def _write_env(updates: dict) -> None:
    """更新 .env 里指定字段 (保留其他行)"""
    if not ENV_FILE.exists():
        ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
        ENV_FILE.write_text("", encoding="utf-8")
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    keys = {
        "base_url": "OPENAI_API_BASE",
        "api_key": "OPENAI_API_KEY",
        "chat_model": "OPENAI_CHAT_MODEL",
        "embed_model": "OPENAI_EMBEDDINGS_MODEL",
    }
    written = set()
    new_lines = []
    for line in lines:
        updated_line = line
        for field, env_key in keys.items():
            if field in updates and line.strip().startswith(env_key + "="):
                updated_line = f"{env_key}={updates[field]}"
                written.add(field)
                break
        new_lines.append(updated_line)
    # 补未找到的字段
    for field, env_key in keys.items():
        if field in updates and field not in written:
            new_lines.append(f"{env_key}={updates[field]}")
    ENV_FILE.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def _apply_to_runtime(
    base_url: str, api_key: str, chat_model: str, embed_model: str
) -> str:
    """即时更新运行时 LLM 池 (无需重启)"""
    try:
        from ktem.llms.manager import llms

        chat_spec = {
            "__type__": "kotaemon.llms.ChatOpenAI",
            "temperature": 0.3,
            "base_url": base_url,
            "api_key": api_key,
            "model": chat_model,
            "timeout": 60,
        }
        if "openai" in llms:
            llms.update("openai", spec=chat_spec, default=True)
        else:
            llms.add("openai", spec=chat_spec, default=True)

        # embedding 仅在有值时更新
        if embed_model:
            embed_spec = {
                "__type__": "kotaemon.embeddings.OpenAIEmbeddings",
                "base_url": base_url,
                "api_key": api_key,
                "model": embed_model,
                "timeout": 30,
            }
            if "openai" in llms:
                pass  # embedding 单独管理，Kotaemon embeddings manager 类似
            try:
                from ktem.embeddings.manager import embeddings

                if "openai" in embeddings:
                    embeddings.update("openai", spec=embed_spec, default=True)
                else:
                    embeddings.add("openai", spec=embed_spec, default=True)
            except Exception as e:
                logger.warning(f"embedding 更新失败 (不影响对话): {e}")

        return "ok"
    except Exception as e:
        logger.exception("运行时更新失败")
        return f"运行时更新失败: {e}"


def _test_llm(base_url: str, api_key: str, chat_model: str) -> tuple[str, str]:
    """发一个测试请求验证配置"""
    if not api_key or "请在UI" in api_key:
        return "❌ 未填 API Key", ""
    try:
        import requests

        resp = requests.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": chat_model,
                "messages": [{"role": "user", "content": "只回复两个字：你好"}],
                "max_tokens": 20,
                "temperature": 0,
            },
            timeout=30,
        )
        if resp.status_code == 200:
            content = resp.json()["choices"][0]["message"]["content"]
            return f"✅ 连接成功！模型回复：{content}", content
        else:
            err = resp.json().get("error", {}).get("message", resp.text[:200])
            return f"❌ HTTP {resp.status_code}: {err}", ""
    except Exception as e:
        return f"❌ 请求失败: {e}", ""


class QuickSetupPage(BasePage):
    """极简模型配置页"""

    def __init__(self, app):
        super().__init__(app)

    def on_building_ui(self):
        gr.Markdown("# ⚡ 模型快速配置")
        gr.Markdown(
            "> 这是使用本软件的**第一步**。只需选择服务商 + 填入 API Key，即可启用全部 AI 功能。"
        )

        current = _read_env()
        current_provider = "自定义 (OpenAI 兼容接口)"
        for name, cfg in PROVIDERS.items():
            if cfg["base_url"] == current["base_url"]:
                current_provider = name
                break

        with gr.Row():
            with gr.Column(scale=2):
                self.provider = gr.Dropdown(
                    label="① 选择 AI 服务商",
                    choices=list(PROVIDERS.keys()),
                    value=current_provider,
                )
                self.api_key = gr.Textbox(
                    label="② 填入 API Key",
                    placeholder="sk-xxxxxxxxxxxx",
                    value=current["api_key"],
                    type="password",
                    lines=1,
                )
            with gr.Column(scale=1):
                gr.Markdown("### 🔑 还没有 Key？")
                self.key_link = gr.Markdown(
                    "[点此获取](https://platform.deepseek.com/api_keys)"
                )

        self.note = gr.Markdown(self._build_note(current_provider))

        with gr.Accordion("③ 高级设置（一般不用改）", open=False):
            self.base_url = gr.Textbox(
                label="接口地址 (Base URL)", value=current["base_url"]
            )
            with gr.Row():
                self.chat_model = gr.Textbox(
                    label="对话模型名", value=current["chat_model"], scale=1
                )
                self.embed_model = gr.Textbox(
                    label="向量模型名 (RAG 用，可留空)",
                    value=current["embed_model"],
                    scale=1,
                )

        with gr.Row():
            self.test_btn = gr.Button("🔍 测试连接", variant="secondary")
            self.save_btn = gr.Button("💾 保存并启用", variant="primary")

        self.result = gr.Markdown("")

        # 当前状态显示
        gr.Markdown("---\n### 📋 当前状态")
        self.status_display = gr.Markdown(self._build_status(current))

    def _build_note(self, provider_name: str) -> str:
        cfg = PROVIDERS.get(provider_name, {})
        note = cfg.get("note", "")
        key_url = cfg.get("key_url", "")
        link = f"\n\n🔗 获取 Key：{key_url}" if key_url else ""
        return f"*{note}*{link}"

    def _build_status(self, current: dict) -> str:
        if current["api_key"] and "请在UI" not in current["api_key"]:
            return (
                f"✅ **已配置**\n\n"
                f"- 服务商: `{current['base_url']}`\n"
                f"- 对话模型: `{current['chat_model']}`\n"
                f"- 向量模型: `{current['embed_model'] or '(未配置，RAG 不可用)'}`\n\n"
                f"AI 功能已就绪，去「🎯学习路线」试试吧！"
            )
        return (
            "⚠️ **未配置 API Key**\n\n"
            "当前 AI 功能不可用（发消息会返回'不知道'）。\n"
            "请上方选择服务商并填入 Key，然后点「💾 保存并启用」。"
        )

    def on_register_events(self):
        # 切换服务商时自动填充
        def on_provider_change(provider_name):
            cfg = PROVIDERS.get(provider_name, {})
            key_url = cfg.get("key_url", "")
            return (
                gr.update(value=cfg.get("base_url", "")),
                gr.update(value=cfg.get("chat_model", "")),
                gr.update(value=cfg.get("embed_model", "")),
                gr.update(value=self._build_note(provider_name)),
                gr.update(
                    value=f"[点此获取]({key_url})" if key_url else "*（自定义接口）*"
                ),
            )

        self.provider.change(
            fn=on_provider_change,
            inputs=[self.provider],
            outputs=[
                self.base_url,
                self.chat_model,
                self.embed_model,
                self.note,
                self.key_link,
            ],
        )

        # 测试连接
        def on_test(api_key, base_url, chat_model):
            msg, _ = _test_llm(base_url, api_key, chat_model)
            return msg

        self.test_btn.click(
            fn=on_test,
            inputs=[self.api_key, self.base_url, self.chat_model],
            outputs=[self.result],
        )

        # 保存
        def on_save(api_key, base_url, chat_model, embed_model):
            if not api_key or "请在UI" in api_key:
                return "❌ 请先填入 API Key", self._build_status(_read_env())
            base_url = base_url.strip()
            chat_model = chat_model.strip()
            embed_model = embed_model.strip()
            try:
                # 1. 写 .env (持久化)
                _write_env(
                    {
                        "base_url": base_url,
                        "api_key": api_key.strip(),
                        "chat_model": chat_model,
                        "embed_model": embed_model,
                    }
                )
                # 2. 清 LLM 配置缓存, 让新配置立即生效
                from learning_ext.llm.client import invalidate_cache

                invalidate_cache()
                # 2. 更新运行时 (即时生效)
                apply_result = _apply_to_runtime(
                    base_url, api_key.strip(), chat_model, embed_model
                )
                if apply_result != "ok":
                    return (
                        f"⚠️ 已写入 .env 但运行时更新失败：{apply_result}\n请重启程序生效。",
                        self._build_status(_read_env()),
                    )
                # 3. 测试一下
                msg, _ = _test_llm(base_url, api_key, chat_model)
                new_status = self._build_status(
                    {
                        "base_url": base_url,
                        "api_key": api_key,
                        "chat_model": chat_model,
                        "embed_model": embed_model,
                    }
                )
                return (
                    f"✅ **配置已保存并生效！**\n\n{msg}\n\n现在可以关闭本页，去「🎯学习路线」开始使用了。",
                    new_status,
                )
            except Exception as e:
                logger.exception("保存失败")
                return f"❌ 保存失败: {e}", self._build_status(_read_env())

        self.save_btn.click(
            fn=on_save,
            inputs=[self.api_key, self.base_url, self.chat_model, self.embed_model],
            outputs=[self.result, self.status_display],
        )

    def as_gradio_component(self):
        return None
