# 学习驾驶舱前后端分离技术设计

## 1. Architecture

```text
launcher.py / PyWebView / browser
              │
              ▼
      FastAPI + Uvicorn :7860
       ├── /api/*       REST + SSE
       ├── /assets/*    Vite build
       └── /*           React SPA fallback
              │
       ┌──────┴──────────────────┐
       ▼                         ▼
learning_ext services     Kotaemon adapters
SQLite + FSRS             RAG + index pipelines
```

开发模式运行 FastAPI 与 Vite dev server，Vite 只代理 `/api`。生产/便携模式只运行 FastAPI，直接服务已构建 SPA。API 和页面同源，生产模式不需要 CORS；开发模式只允许本机 Vite origin。

## 2. Package boundaries

新增 Python 包：

```text
learning_ext/api/
├── app.py                 FastAPI factory 与静态资源
├── dependencies.py        Session、用户和 index 依赖
├── security.py            Host/Origin、日志脱敏和资源归属守卫
├── schemas/               Pydantic API DTO
├── routes/
│   ├── health.py
│   ├── home.py
│   ├── config.py
│   ├── projects.py
│   ├── nodes.py
│   ├── review.py
│   ├── dashboard.py
│   ├── chat.py
│   └── library.py
└── streaming.py           SSE 编码、事件类型和生成器桥接

learning_ext/kotaemon_adapter/
├── chat.py                reasoning pipeline → 结构化事件
└── library.py             index pipeline、文件/分组查询与删除
```

新增前端：

```text
learning_ext/web/
├── package.json
├── vite.config.ts
├── src/
│   ├── app/               router、query client、shell
│   ├── api/               DTO、REST client、SSE client
│   ├── components/        通用可访问组件
│   ├── features/          home/course/review/chat/library/dashboard/config/help
│   ├── styles/            token、reset、layout
│   └── test/
└── dist/                  production build，打包时必需
```

API route 禁止导入 `learning_ext.pages`。旧页面已经删除，可复用的 orchestration 已下沉到现有 service 或新的学习层 service；service 保持 `session: Session` 为第一参数。

## 3. API shape

核心 REST：

- `GET /api/health`
- `GET /api/home`
- `GET /api/config/status`
- `PUT /api/config`
- `POST /api/config/test`
- `GET /api/projects`
- `GET /api/projects/{id}`
- `DELETE /api/projects/{id}`
- `GET /api/projects/{id}/roadmap`
- `GET /api/projects/{id}/nodes`
- `GET /api/nodes/{id}`
- `PATCH /api/nodes/{id}/status`
- `GET|PUT /api/nodes/{id}/note`
- `GET /api/nodes/{id}/resources`
- `GET /api/review/stats`
- `GET /api/review/next`
- `POST /api/review/{card_id}/rate`
- `GET /api/dashboard`
- `GET|POST /api/chat/conversations`
- `GET|PATCH|DELETE /api/chat/conversations/{id}`
- `GET /api/library/indices`
- `GET /api/library/files`
- `DELETE /api/library/files/{id}`
- `GET|POST|PATCH|DELETE /api/library/groups...`

流式 POST：

- `/api/projects/generate/stream`
- `/api/projects/{id}/refine/stream`
- `/api/projects/{id}/prepare/stream`
- `/api/nodes/{id}/content/stream`
- `/api/nodes/{id}/practice/stream`
- `/api/nodes/{id}/resources/stream`
- `/api/chat/stream`
- `/api/library/index/stream`

API schema 使用专用 Pydantic DTO，禁止直接返回 SQLModel ORM 或 Kotaemon Document。错误使用稳定 code 和用户可执行 message。

## 4. SSE protocol

响应类型为 `text/event-stream; charset=utf-8`，每个帧：

```text
event: delta
id: <request-id>:<sequence>
data: {"text":"正在分析"}

```

事件定义：

- `start`：请求 ID、任务类型和初始元数据。
- `progress`：阶段、已完成数、总数和可显示说明。
- `delta`：可追加的文本增量，仅用于自然语言输出。
- `citation`：引用 ID、标题、页码/片段和可打开资源标识。
- `result`：完整结构化业务结果，例如最终路线或索引结果。
- `error`：稳定错误 code、可执行 message 和 retryable；不包含 traceback、prompt 或 key。
- `done`：最终状态、耗时和可选 usage。

所有流必须以 `start` 开始，以 `done` 或 `error` 结束。前端使用 `fetch` + SSE parser 和 `AbortController`；取消时关闭响应读取，后端在迭代同步 generator 之间检查断开，并在 `finally` 关闭底层 iterator/session。

现有同步 generator 通过“单一 owner worker + 有界 AnyIO channel”的 async bridge 拉取，不能阻塞 event loop。iterator、Session 和 cleanup 均在同一 worker thread 创建/关闭，禁止在 `next()` 执行期间从另一线程调用 `close()`。HTTP 断开可以立即停止响应，但正在阻塞的同步 LLM/parser/embedding 调用只能协作式、最终取消；每层循环必须在下一次副作用前检查取消标志。路线 JSON 生成仍在服务端完整解析和校验，期间只发 `progress`，最终发单个 `result`。

## 5. Kotaemon adapters

### Chat

adapter 首版只支持已验证的 simple reasoning，复用其 `stream()`，但不实例化 `ChatPage`。它负责：

- 根据请求中的 index/file selection 创建 retriever 和 reasoning pipeline。
- 将 `Document(channel="chat")` 转成 `delta`。
- 使用 RecordingRetriever 在 Kotaemon 把信息渲染成 HTML 前截获 RetrievedDocument，并转成去重、限长、纯文本 `citation`；禁止解析或返回 `channel="info"` HTML。
- 保存/读取对话状态时使用学习层 DTO，不把 Gradio update 对象暴露给 API。

Kotaemon 公共 retriever factory 依赖 Gradio selector，因此 adapter 在单一 compatibility 模块中隔离 `_retriever_pipeline_cls`、resources、vector/doc store 等私有访问，并以当前 Kotaemon 版本做契约测试。其他高级 reasoning 在具备独立 API 契约前不作为产品能力暴露。

### Library

adapter 直接调用 `FileIndex.get_indexing_pipeline()` 及其 `stream()`，不调用包含 `gr.Info`/`gr.Warning` 的 `FileIndexPage.index_fn()`。文件列表和删除逻辑在学习层 adapter 中复用 index resources 与 engine，保持私有 collection 的 user 过滤和文件校验。

上传文件先保存到请求独占临时目录，再按文件进入索引 pipeline；关闭 `quick_index_mode`，让 embedding 完成后才发 `done`。索引跨 SQLite、文件、docstore、vectorstore 非原子，adapter 记录本次新增 ID 并在失败/取消后做补偿清理，绝不误删 reindex 前已存在产物。强制 reindex 的非原子风险在 UI 明示。

### Config

provider 元数据、`.env` 原子读写、连接测试和运行时 manager 更新下沉到非 Gradio service。使用实际存在的 `ktem.embeddings.manager.embedding_models_manager`，保存成功后清除 learning LLM cache；响应只返回配置状态和能力，不返回密钥或含密钥的 manager spec。

## 6. Frontend stack and state

- React + TypeScript + Vite。
- React Router 管理页面路由。
- TanStack Query 管理 REST server state、缓存和失效。
- `fetch` + SSE parser 管理流；流式内容保留在 feature local state，完成后再写入 Query cache。
- 表单使用受控组件和轻量 schema 校验；不把 API key 放进全局 store、URL 或持久化浏览器存储。
- CSS variables + CSS Modules 实现视觉系统，避免通用组件库把界面拉回模板风格；Dialog/Accordion 等行为可使用少量无样式可访问 primitives。

## 7. Information architecture and visual system

桌面布局：

```text
┌──────────────┬──────────────────────────────────────────────┐
│ LearnEverything│ 当前项目                                   │
│ 今日         │                                              │
│ 课程         │ 页面内容                                     │
│ 复习         │                                              │
│ 知识问答     │                                              │
│ 资料库       │                                              │
│ 学习进度     │                                              │
│              │                                              │
│ 模型配置     │                                              │
│ 使用帮助     │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

课程内分继续学习、学习计划、项目管理。小于 960px 时侧栏改为紧凑顶部导航，工作台目录和 AI 助教改为抽屉。

视觉 token：Fog `#F5F7FB`、Paper `#FFFFFF`、Ink `#172033`、Indigo `#4E5BD5`、Mint `#2FA37A`、Amber `#D58B27`。字体只使用离线系统栈。唯一视觉签名是由真实课程节点构成的“学习轨迹”，不使用通用渐变英雄区和同质指标卡阵列。

## 8. Long roadmap browser

路线页使用 React 结构化渲染，不渲染服务端 HTML：

- 左侧目录按 stage 分组，显示节点数、编号、标题和当前状态。
- 右侧固定内容区域独立滚动；节点详情使用可访问 Accordion。
- 点击目录调用 `scrollIntoView()` 并更新当前节点；IntersectionObserver 在用户滚动时同步目录高亮。
- 课程编号使用现有 `course_code_sort_key` 的服务端排序结果，API 同时返回稳定 node ID。
- 所有 LLM 文本作为 React text node 输出；教学 Markdown 使用禁止原始 HTML的安全 renderer。
- 50 节点为最低验收规模。首版不做 virtualization，避免锚点目标被卸载；达到数百节点后再基于实测引入虚拟列表。

## 9. Page behavior

- 今日：setup/empty/active/complete 四状态，只突出一个下一步。
- 课程：正文主区、可收纳目录、AI 抽屉；计划页使用长路线浏览器；项目管理承载高级操作。
- 复习：问题 → 查看答案 → 四档评分，评分成功自动下一张。
- 知识问答：流式正文、独立引用面板、来源选择和取消按钮。
- 资料库：上传/URL、索引进度、文件/分组、筛选、下载与删除确认。
- 学习进度：项目选择、进度轨迹、14 天趋势、状态分布和日报。
- 模型配置：连接状态、服务商、密钥、高级设置；API 永不回显密钥。
- 使用帮助：本地内容，不请求远程 Kotaemon changelog。

## 10. Server and desktop integration

`custom_app.py` 创建 headless Kotaemon context、FastAPI app 并运行 Uvicorn，不构建浏览器 UI 对象。API route 先注册，SPA 静态挂载最后注册。

`launcher.py` 将 Gradio 专属函数/日志改为通用 backend 语义，继续传递选择后的 host/port。PyWebView 和浏览器继续打开根 URL。

前端构建产物位于 `learning_ext/web/dist`，`pack_portable.bat` 已复制整个 `learning_ext`，但打包前必须显式验证 dist 存在并运行 production build。安装脚本只在开发模式需要 Node；分发包不包含 `node_modules`。

## 11. Compatibility, security, and rollback

- 保持 SQLite 和 Kotaemon 单进程访问，避免额外并发写入模型。
- 使用 injectable `create_app()`，API 测试不构建重量级 Kotaemon runtime；生产 Uvicorn 固定单 worker。
- 服务端用户固定来自本地上下文，不接受请求中的 `user_id`。项目、节点、卡片、会话、文件和分组全部通过 ownership resolver 获取；不存在和越权统一 404。
- 生产同源；TrustedHost 只允许 localhost/127.0.0.1。写请求校验 Origin，开发 CORS 只允许精确的本机 Vite origin，不使用 `*`。
- API key 不出现在 GET 响应、日志、SSE、错误或浏览器持久化中。
- 上传校验文件数、大小、后缀和安全文件名；下载只接受授权资源 ID，并验证解析路径仍位于存储根目录。
- URL 索引拒绝凭据、loopback、private、link-local、multicast 地址和不安全重定向；底层 reader 无法保证时默认关闭 URL 索引而保留文件上传。
- 同一会话、index 和项目写流分别加单进程锁，冲突返回 `409 RESOURCE_BUSY`。
- `learning_ext/app.py`、`custom_app.py`、`launcher.py` 当前均可能包含用户未提交改动，实施基于当前内容增量修改，不重置。
- `/legacy` 固定返回 404，避免旧 UI 被误认为仍受支持。
- API 与 React 是唯一产品路径，回滚通过版本控制完成，不保留运行时双 UI 分支。

## 12. Design critique

React 并不会自动产生好产品，侧栏和卡片仍容易变成通用 SaaS 模板。设计把大胆选择集中在真实学习轨迹、长路线导航和课程位置感上；其余页面用克制的排版和状态层级服务任务。迁移框架的价值是获得可靠的结构、状态和交互能力，不是增加动画或视觉装饰。
