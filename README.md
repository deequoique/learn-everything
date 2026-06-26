# 学习 Agent (Learn Everything)

> 给任意选题，AI 制定学习路线 + 辅助搭建系统环境 + 给出实操；带知识库、文献管理、学习进度跟踪、艾宾浩斯记忆曲线复习、查漏补缺测验。**Windows 桌面应用，双击 exe 即用。**

基于开源 [Kotaemon](https://github.com/Cinnamon/kotaemon) (RAG 底座) + FSRS v6 (记忆算法) + 自建学习特化模块。

## 快速开始

### 首次使用（开发者/高级用户）
1. **初始化环境**（需联网，约 5-15 分钟）：双击 `setup.bat`
2. **配置 LLM**：编辑 `kotaemon\.env`，填入任一 API key（DeepSeek 推荐）
3. **启动**：双击 `run.bat`，或开发模式 `python launcher.py`

### 打包成 exe 分发
1. `build_exe.bat` — PyInstaller 打包 launcher 为 `LearnEverything.exe`
2. `pack_portable.bat` — 组装完整便携版（含运行时，解压即用）

## 文件说明

| 文件 | 作用 |
|---|---|
| `launcher.py` | 桌面启动器：启动 Gradio 后端 + PyWebView 桌面窗口 |
| `custom_app.py` | 后端入口：加载 LearningApp（Kotaemon + 学习 Tab） |
| `setup.bat` | 首次环境初始化（装 uv + venv + 依赖） |
| `run.bat` | 启动程序 |
| `build_exe.bat` | 打包 launcher.exe |
| `pack_portable.bat` | 组装可分发的完整便携版 |
| `learning_ext/` | 学习特化代码（路线/复习/测验/看板等） |
| `kotaemon/` | RAG 底座（fork，不改动） |

## 功能矩阵

| 功能 | 状态 | 说明 |
|---|---|---|
| 🎯 选题→学习路线 | ✅ 阶段1 | AI 拆知识 DAG，分阶段，可调整重生成 |
| 💬 知识库 RAG 问答 | ✅ 底座 | 上传 PDF/文献，带引用溯源 |
| 🔄 艾宾浩斯复习 | 🔜 阶段2 | FSRS v6 调度，4 档评分 |
| 📝 查漏测验 | ⏳ 阶段3 | AI 按薄弱点出题批改 |
| 📊 学习看板 | ⏳ 阶段3 | 热力图/甘特/掌握度/日报 |
| 🧑‍🏫 费曼对话 | ⏳ 阶段4 | AI 扮小白逼你讲解 |
| 🛠️ 实操辅助 | ⏳ 阶段4 | 编程选题自动出环境清单+练习 |
| 📤 导出 | ⏳ 阶段4 | Anki 牌组 / Markdown / PDF 报告 |

## 技术栈
- **底座**: Kotaemon (Gradio + SQLite + Chroma + LanceDB)
- **记忆**: fsrs (FSRS v6)
- **桌面**: PyWebView (Edge WebView2)
- **打包**: PyInstaller
- **LLM**: DeepSeek / GLM / 通义 / OpenAI / Ollama (任选)

## 项目结构
详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
