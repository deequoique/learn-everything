# 学习驾驶舱前后端分离实施计划

## 0. Baseline and protection

- [ ] 记录当前 git status、涉及文件 diff 和本地启动状态，保留全部用户改动，不重置工作区。
- [ ] 保存当前所有 Gradio 页面截图与 50 节点长路线基线。
- [ ] 记录现有测试基线：页面/看板目标测试 40 passed、3 个 tiktoken 离线导入失败；全量 Ruff 29 个既存问题。
- [ ] 修复测试环境绕过 `custom_app.py` fallback 的导入前置，但不改变生产 tokenizer 语义。

## 1. API foundation

- [ ] 新建 `learning_ext/api` app factory、dependencies、schemas、route 分包和统一错误模型。
- [ ] 建立 Session dependency、服务端默认本地用户、ownership resolvers、API request ID 和递归安全日志过滤；不存在与越权统一 404。
- [ ] 添加 TrustedHost、写请求 Origin guard 和精确开发 CORS；覆盖 localhost/恶意网页访问测试。
- [ ] 实现 `/api/health`，为 launcher 等待逻辑增加 HTTP health 探测。
- [ ] 为 API schema/ORM 解耦、404/validation/error code 添加 pytest。
- [ ] 建立 FastAPI TestClient 测试夹具，使用独立 SQLite 和 Mock LLM。

## 2. Streaming foundation

- [ ] 实现 SSE event dataclass/encoder，固定七种事件和 JSON data 格式。
- [ ] 实现单一 owner worker + 有界 AnyIO channel 的同步 generator → async SSE bridge，检查断开、传播协作式取消并在 worker thread 可靠关闭 iterator/session。
- [ ] 添加事件顺序、JSON 转义、异常脱敏、客户端断开和取消测试。
- [ ] 将 `learning_ext.llm.chat(stream=True)` 暴露为最小测试流，验证真实 HTTP 分块而非响应结束后一次性返回。

## 3. Learning REST and stream APIs

- [ ] 把首页状态聚合下沉为 `build_home_data(session, configured, user_id)`，实现 home API 及四状态测试。
- [ ] 实现配置 status/test/save API，确保永不返回 API key。
- [ ] 把配置逻辑从 Gradio page 抽成 service，原子写 `.env`，修正 `embedding_models_manager` 热更新并覆盖缓存失效/密钥脱敏测试。
- [ ] 实现项目列表、详情、生成、调整、保存、准备、导入导出、审计和删除 API；将页面内 orchestration 下沉到 service。
- [ ] 实现节点列表/详情/状态、课程内容、实操、笔记、参考资料 API。
- [ ] 实现复习 stats/next/rate API，四档评分成功后返回下一张所需状态。
- [ ] 实现 dashboard API，移除生产 UI 的测试数据操作。
- [ ] 为所有路由覆盖空状态、非法 ID、业务异常和权限/归属过滤。

## 4. Kotaemon adapters

- [ ] 新增无 Gradio 依赖的 simple-reasoning chat adapter；把 headless retriever 私有访问隔离在 compatibility 模块并加 Kotaemon 版本契约测试。
- [ ] 用 RecordingRetriever 在 HTML 渲染前截获、去重和限长 citations；禁止泄露 `info` HTML/plot。
- [ ] 实现 conversation 列表/创建/读取/改名/删除 API，所有读写带 ownership，并防止同会话并发流。
- [ ] 实现 chat stream API，覆盖 delta、citation、done、空回答、pipeline 异常和取消。
- [ ] 新增 library adapter，直接调用 FileIndex indexing pipeline，复用并加强文件类型/大小/数量/安全文件名校验；禁用 quick index。
- [ ] 实现文件/分组列表、上传与 URL 索引流、下载和删除确认 API；所有操作带 ownership 和 index 写锁。
- [ ] 为 URL 索引增加 DNS/重定向目标校验；无法保证时默认关闭该入口。
- [ ] 为新上传失败/取消实现跨 SQL、文件、docstore、vectorstore 的补偿清理；强制 reindex 风险明确反馈。
- [ ] 用集成测试验证索引后的文件能被 chat selection 检索，不调用 `FileIndexPage` 或其他 Gradio page。

## 5. React/Vite foundation

- [ ] 在 `learning_ext/web` 初始化 React + TypeScript + Vite；锁定 Node 20.19+ 开发要求和 npm lockfile。
- [ ] 配置 Vite dev proxy、生产 base、TypeScript strict、ESLint、Vitest、Testing Library 和 Playwright。
- [ ] 建立 React Router、TanStack Query、REST client、SSE client 和统一错误/空状态。
- [ ] 实现 AbortController 取消、SSE parser、事件 reducer 和流结束后的 Query cache 失效；添加前端单元测试。
- [ ] 建立视觉 token、字体栈、焦点、reduced-motion 和 960px 响应式基础。

## 6. Shell and status-aware home

- [ ] 实现桌面侧栏/窄屏导航、当前项目上下文和八个主入口。
- [ ] 实现 setup/empty/active/complete 首页，展示学习轨迹、下一节点和到期复习。
- [ ] 验证首屏不暴露 API key、数据库 ID 或后端术语。
- [ ] 完成外壳和首页第一轮浏览器截图审查后再进入全页面实现。

## 7. Course and long-roadmap experience

- [ ] 实现课程页的继续学习、学习计划和项目管理二级路由。
- [ ] 实现长路线目录：阶段分组、节点数量、编号/标题、滚动同步高亮和节点定位。
- [ ] 实现独立滚动路线正文与 Accordion 节点详情；教学 Markdown 禁止原始 HTML。
- [ ] 添加 50 节点路线测试，验证编号顺序、目录映射、定位、折叠、长文本和脚本注入安全。
- [ ] 实现路线生成/调整/准备 SSE 进度，最终 result 替换路线；永不渲染半截 JSON。
- [ ] 实现正文主区、课程目录抽屉、AI 助教抽屉、课程内容/实操/笔记/资料和节点状态。

## 8. Remaining React pages

- [ ] 实现复习页：问题、答案、评分、自动下一张和完成态。
- [ ] 实现知识问答：会话、来源选择、流式回答、引用、取消和错误重试。
- [ ] 实现资料库：上传/URL、索引进度、文件/分组、筛选、下载和删除确认。
- [ ] 实现学习进度：项目选择、进度轨迹、14 天趋势、状态分布和日报。
- [ ] 实现模型配置：连接状态、服务商、密钥、高级设置和保存后返回首页。
- [ ] 实现本地帮助与隐私/数据位置说明；全部功能只通过 React 产品入口呈现。

## 9. FastAPI host and launcher

- [ ] 重构 `custom_app.py`：创建 headless Kotaemon runtime 与 FastAPI、注册 API、最后挂载 SPA，不导入或构造 Gradio UI。
- [ ] 重构 launcher 的 Gradio 专属命名和等待逻辑，使用 `/api/health` 验证服务就绪，保留浏览器/PyWebView 降级。
- [ ] 增加 dev 启动脚本和 production 启动路径；缺失 web dist 时给出明确构建提示或开发 fallback。
- [ ] 更新 setup/build/portable 脚本：开发构建需要 Node 20.19+，运行分发包不需要 Node；禁止打包 `node_modules`。
- [ ] 验证 Windows 路径、macOS 浏览器路径和 port fallback。

## 10. Documentation and migration cleanup

- [ ] 更新 README、ARCHITECTURE、安装/开发/打包说明和页面导航。
- [ ] 删除旧 Gradio 页面、LearningApp、页面资源和 UI 测试；用户帮助只描述 React 产品路径。
- [ ] 全局搜索旧按钮、手填项目 ID、“阶段 3 开放”和 Gradio 专属用户文案。
- [ ] 清理本任务触及 Python/TypeScript 文件的 lint 问题，不扩大到无关模块。

## 11. Verification gates

- [ ] Python：API、service、SSE、Kotaemon adapter、页面既有业务回归测试通过。
- [ ] 前端：TypeScript、ESLint、Vitest 和 production Vite build 通过。
- [ ] E2E：新用户配置→建路线→50 节点导航→保存→学习→提问→复习→看板主路径通过。
- [ ] E2E：聊天 token 流、RAG citation、路线 progress/result、文件 index progress 和 AbortController 取消通过。
- [ ] 安全：API key 不回显，LLM HTML 不执行，文件归属/路径校验，SSE error 不泄露 traceback。
- [ ] 安全：恶意 Host/Origin、跨用户对象 ID、URL SSRF、路径穿越和索引部分失败补偿测试通过。
- [ ] 视觉：1440×900、1280×720、约 960px 全量页面截图走查，无水平滚动、遮挡和不可达操作。
- [ ] 启动：macOS 浏览器模式、PyWebView 可用时桌面模式、Windows portable 构建路径验证。

## 12. Review and rollback points

- [ ] API/SSE 基础完成后进行第一道架构审查，未通过不进入 React 业务页。
- [ ] 外壳/首页/路线完成后进行第二道产品与视觉审查，确认长路线问题真实解决。
- [ ] Chat/library adapter 完成后对照 API 契约做能力 parity 审查。
- [ ] FastAPI 根入口切换后验证 `/legacy` 为 404 且生产进程未导入旧 UI 模块。
- [ ] 最终逐条对照 PRD 验收并记录证据；未通过不进入 finish/commit。

## Implementation evidence (2026-08-18)

- FastAPI factory、Host/Origin guard、ownership resolver、REST DTO、固定七类 SSE、协作取消和 SPA fallback 已实现。
- `custom_app.py` 已切到单 worker Uvicorn，并成功 smoke `/api/health` 与 React 深链。
- React 驾驶舱八个入口、状态首页、路线生成表单、工作台及其余页面已实现。
- 50 节点路线单测覆盖目录/正文一一映射、折叠、定位、滚动高亮和 HTML inert；浏览器在 1280×720、960×720、1440×900 无水平溢出，960px 使用目录抽屉。
- Python focused tests：28 passed；全套：159 passed、1 failed、6 skipped。该历史失败来自已删除的旧 UI 源码断言，移除旧 Web 后不再适用。
- Frontend：typecheck、ESLint、Vitest 15/15、Vite production build 全部通过。
- Windows portable 脚本已强制 web build、验证 `dist/index.html` 并排除 `node_modules`；Windows 无 Node 干净机 smoke 尚需在 Windows 环境执行。
- Kotaemon compatibility seam、检索前结构化引用、multipart 文件索引、协作取消、跨 SQL/文件/docstore/vectorstore 的补偿与不完整清理告警均已落地并有回归测试；真实供应商 RAG/embedding 仍需在已配置模型的环境做专项集成验证。
- 会话消息与来源选择持久化、资料分组 CRUD/归属校验和文件下载入口已补齐。
- 浏览器在 1280×720 与 960×720 验证无水平溢出，路线目录在 960px 切为抽屉；浏览器会话和生产测试服务均已关闭。
- 2026-08-19 用户确认移除旧 Web：`LearningApp`、`learning_ext/pages`、旧页面资源与 `/legacy` mount 已删除；生产入口改用 headless Kotaemon context，health 不再暴露 legacy 状态，`/legacy` 固定为 404。
