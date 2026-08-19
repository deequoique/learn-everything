# 学习 Agent (Learn Everything)

> 给任意选题，AI 制定学习路线 + 辅助搭建系统环境 + 给出实操；带知识库、文献管理、学习进度跟踪、艾宾浩斯记忆曲线复习、查漏补缺测验。**Windows 桌面应用，双击 exe 即用。**

基于开源 [Kotaemon](https://github.com/Cinnamon/kotaemon) (RAG 底座) + FSRS v6 (记忆算法) + 自建学习特化模块。

## 快速开始

### 首次使用（开发者/高级用户）
1. **初始化环境**（需 Python/uv 和 Node.js 20.19+，约 5-15 分钟）：双击 `setup.bat`
2. **配置 LLM**：从驾驶舱「模型配置」连接任一 OpenAI 兼容服务
3. **启动**：双击 `run.bat`，或开发模式 `python launcher.py`

### 打包成 exe 分发
1. `build_web.bat` — 测试并构建 React 驾驶舱
2. `build_exe.bat` — PyInstaller 打包 launcher 为 `LearnEverything.exe`
3. `pack_portable.bat` — 组装完整便携版（用户端不需要 Node）

### macOS 浏览器运行

```bash
./setup_macos.sh
./run_macos.sh
```

启动器会启动本地 FastAPI 服务并打开 React 学习驾驶舱。macOS 浏览器版不需要 PyWebView。

## 文件说明

| 文件 | 作用 |
|---|---|
| `launcher.py` | 桌面启动器：启动 FastAPI 后端 + PyWebView/浏览器 |
| `custom_app.py` | 后端入口：启动 API、Kotaemon headless runtime 和 React |
| `build_web.bat/.sh` | 前端测试与生产构建（Node 仅构建时需要） |
| `setup.bat` | 首次环境初始化（装 uv + venv + 依赖） |
| `run.bat` | 启动程序 |
| `build_exe.bat` | 打包 launcher.exe |
| `pack_portable.bat` | 组装可分发的完整便携版 |
| `setup_macos.sh` | macOS 首次环境初始化 |
| `run_macos.sh` | macOS 浏览器启动入口 |
| `learning_ext/` | 学习特化代码（路线/复习/测验/看板等） |
| `kotaemon/` | RAG 底座（fork，不改动） |

## 功能矩阵

| 功能 | 状态 | 说明 |
|---|---|---|
| 🎯 选题→学习路线 | ✅ 阶段1 | AI 拆知识 DAG，分阶段，可调整重生成 |
| 💬 知识库 RAG 问答 | ✅ 底座 | 上传 PDF/文献，带引用溯源 |
| 🔄 艾宾浩斯复习 | ✅ | FSRS v6 调度，4 档评分 |
| 📝 查漏测验 | ⏳ 阶段3 | AI 按薄弱点出题批改 |
| 📊 学习看板 | ✅ | 14 天趋势、掌握度和日报 |
| 🧑‍🏫 费曼对话 | ⏳ 阶段4 | AI 扮小白逼你讲解 |
| 🛠️ 实操辅助 | ⏳ 阶段4 | 编程选题自动出环境清单+练习 |
| 📤 导出 | ⏳ 阶段4 | Anki 牌组 / Markdown / PDF 报告 |

## 技术栈
- **前端**: React + TypeScript + Vite
- **API**: FastAPI REST + POST SSE
- **底座**: Kotaemon headless runtime (SQLite + Chroma + LanceDB)
- **记忆**: fsrs (FSRS v6)
- **桌面**: PyWebView (Edge WebView2)
- **打包**: PyInstaller
- **LLM**: DeepSeek / GLM / 通义 / OpenAI / Ollama (任选)

## 项目结构
详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
