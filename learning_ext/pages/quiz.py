"""测验 Tab 骨架 - 阶段 3 填充。AI 出题、用户作答、AI 批改。"""

from __future__ import annotations

import logging

import gradio as gr
from ktem.app import BasePage

logger = logging.getLogger(__name__)


class QuizPage(BasePage):
    """查漏补缺测验页面 (阶段 3 填充)"""

    def __init__(self, app):
        super().__init__(app)

    def on_building_ui(self):
        gr.Markdown("# 📝 查漏补缺测验")
        gr.Markdown(
            "AI 根据你的**薄弱知识点**自动出题，支持选择/填空/简答/实操。答完后 AI 自动批改并更新掌握度。"
        )
        gr.Markdown(
            "> 💡 **使用方法**：填入「项目 ID」（在学习路线页保存后可查到）→ 选择题目数量和题型 → 点击生成。测验时 AI 会优先针对你掌握度低的知识点出题。"
        )

        gr.Markdown("---")
        with gr.Row():
            self.project_id = gr.Number(label="学习项目 ID", value=1, precision=0)
            self.count = gr.Slider(
                label="题目数量", minimum=1, maximum=20, value=5, step=1
            )
            self.qtype = gr.Dropdown(
                label="题型",
                choices=[
                    ("混合出题", "mixed"),
                    ("选择题", "choice"),
                    ("填空题", "fill"),
                    ("简答题", "short"),
                    ("实操题", "practice"),
                ],
                value="mixed",
            )
        self.btn_gen = gr.Button("🎯 生成测验（优先针对薄弱点）", variant="primary")

        gr.Markdown("---\n### 📋 答题区")
        self.status = gr.Markdown(
            "*测验功能将在阶段 3 完整开放。当前路线已可生成并保存知识点，复习功能已可用。*"
        )

    def on_register_events(self):
        # TODO 阶段3: 接 generate_quiz / grade_answer
        def _coming_soon(pid, cnt, qt):
            return f"⏳ 测验交互将在阶段 3 开放。已收到请求：项目 {pid}，{cnt} 题，题型 {qt}。请先使用「🎯学习路线」和「🔄间隔复习」。"

        self.btn_gen.click(
            fn=_coming_soon,
            inputs=[self.project_id, self.count, self.qtype],
            outputs=[self.status],
        )
