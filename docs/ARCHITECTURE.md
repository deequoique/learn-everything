# 学习 Agent 架构

> React 学习驾驶舱是唯一产品界面，Kotaemon 作为无页面运行时提供 RAG 与索引能力。

## 总体结构

```text
launcher.py / PyWebView / browser
              │
              ▼
      FastAPI + Uvicorn :7860
       ├── /api/*       REST + POST SSE
       ├── /assets/*    Vite production build
       └── /*           React Router SPA fallback
              │
       ┌──────┴──────────────────┐
       ▼                         ▼
learning_ext services     Kotaemon adapters
SQLite + FSRS             RAG + file indices
```

`launcher.py` 仍使用双进程模型：主进程负责 PyWebView/浏览器和子进程生命周期，
子进程使用 Kotaemon venv 运行 `custom_app.py`。启动器通过 `/api/health` 判断应用
真正就绪，并支持默认端口被占用时选择动态端口。

## 代码边界

```text
learning_ext/
├── api/                  FastAPI factory、REST、SSE、安全和 SPA 托管
├── web/                  React + TypeScript + Vite
├── kotaemon_adapter/     无页面依赖的 Kotaemon 兼容层
├── config/               模型配置、原子 .env 写入和运行时热更新
├── db/                   学习数据 SQLModel
├── path_generator/       学习路线生成与持久化
├── progress/             节点状态和学习进度
├── fsrs_review/          FSRS v6 调度
├── dashboard/            看板聚合
├── notes/                笔记和节点资料
```

学习特化代码不修改 `kotaemon/`。API route 只调用学习 service 或
`learning_ext/kotaemon_adapter`。Kotaemon 的私有检索
属性只允许出现在 `kotaemon_adapter/compatibility.py`，以便升级时集中验证。

## HTTP 和流式契约

生产环境由 FastAPI 同源提供 API 与 React。Vite 开发服务器只代理 `/api`。
服务仅绑定 loopback，并限制 Host；浏览器写请求还要通过
Origin 校验。

AI 对话、路线生成与长任务使用基于 `fetch` POST 的 SSE。固定事件为：

```text
start → progress | delta | citation | result → done
                                      └──────→ error
```

每个 `data` 都是 JSON。路线生成期间只发送阶段进度，最终一次发送通过校验的完整
路线。同步生成器由单 owner worker 驱动；HTTP 断开会立即停止响应并设置取消信号，
阻塞中的模型/解析/embedding 调用在返回后进行协作式清理。

## 数据和权限

学习表沿用 `le_` 前缀并共享 Kotaemon SQLite engine。API 使用服务端确定的本地
用户 `default`，不接受客户端 `user_id`。项目、节点、复习卡、笔记、会话和资料
均先做归属解析；不存在和越权都返回相同 404。API DTO 与 ORM/Kotaemon Document
解耦，模型密钥永不出现在状态响应、日志或 SSE 错误中。

核心关系：

```text
User → LearningProject → KnowledgeNode → Card / Task / Note / Resource
                         └──────────────→ ProgressRecord
```

## 前端信息架构

React 主导航固定为今日、课程、复习、知识问答、资料库、学习进度、模型配置和使用
帮助。课程内包含继续学习、学习计划和项目管理。长路线使用阶段/节点目录和独立滚动
正文，节点详情默认折叠；目录点击和正文滚动会同步当前节点。工作台保持正文为主，
课程目录和 AI 助手按需打开，避免三栏同时挤压正文。

## 构建和分发

Node.js 20.19+ 只用于源码开发和发布构建：

```bash
./build_web.sh        # npm ci + Vitest + Vite build
```

Windows 使用 `build_web.bat`。`pack_portable.bat` 在复制前强制完成前端构建，验证
`learning_ext/web/dist/index.html`，并排除 `node_modules`、coverage 和测试产物。
便携版用户只需要随包携带的 Python/Kotaemon 运行时，不需要 Node。

## 开发约定

- service 函数第一参数保持 `session: Session`。
- LLM 调用统一走 `learning_ext.llm.chat/chat_json`。
- API schema 不直接暴露 SQLModel 或 Kotaemon 对象。
- 产品页面放在 `learning_ext/web/src/features`；后端不得构造浏览器 UI 对象。
- 修改 launcher 后需重新运行 `build_exe.bat`；发布前必须运行前后端测试和 web build。
