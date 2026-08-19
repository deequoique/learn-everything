# 学习驾驶舱前后端分离重构

## Goal

把当前 Gradio“功能 Tab 集合”升级为 React/Vite 学习驾驶舱，并通过 FastAPI 将现有 Python 学习服务和 Kotaemon RAG 暴露为稳定 API。首次用户无需阅读说明书即可完成配置与建课，回访用户打开应用后能直接继续当前课程或处理今日复习；长学习路线、流式 AI 输出和资料管理具备产品级交互能力。

## Background and confirmed facts

- 当前 `LearningApp.ui()` 将使用指南、模型配置、知识问答、学习路线、学习工作台、间隔复习、查漏测验、学习看板、资料库和帮助作为同权顶部 Tab 展示，默认首页是长篇使用指南（`learning_ext/app.py:470-540`）。
- 学习路线页同时承载生成、保存、项目列表、按 ID 加载、导入导出、审计和删除；路线结果由 `_roadmap_to_markdown()` 把所有节点及描述拼成单个长文档，没有目录、锚点、折叠或独立滚动（`learning_ext/pages/path_generator.py:45-171,717-765`）。
- 学习工作台固定为项目/课程、正文、AI 助教三栏，在常见 1280px 视口下正文被压窄（`learning_ext/pages/study_workbench.py:181-406`）。
- 学习页面约有 210 处 Gradio 组件或事件绑定；不少页面 handler 直接打开数据库 Session，因此当前不存在可供独立前端使用的学习 API 层。
- 路线、进度、FSRS、笔记、看板等核心业务已经位于 `learning_ext` service 模块，可被 API 复用，不需要重写算法或数据库模型。
- `learning_ext.llm.chat(..., stream=True)`、工作台助教、路线准备流程、Kotaemon reasoning 和文件索引均已有同步生成器或流式 pipeline，可包装成 SSE。
- FastAPI 和 Uvicorn 已存在于 Kotaemon venv；本机 Node 为 20.20.2，满足现代 Vite 开发要求。
- 启动器本来就是“启动本地 HTTP 子进程 → 等待端口 → 浏览器或 PyWebView 打开 URL”，可以把服务端从 Gradio launch 改为 FastAPI host，而无需重写桌面窗口模型。
- `learning_ext/` 必须保持独立，不修改 `kotaemon/` 子模块。Kotaemon 问答和索引能力通过学习层 adapter 调用。

## Requirements

- R1：新增 React + TypeScript + Vite 前端，默认由现有本地服务和桌面启动器打开；Gradio 不再作为默认用户界面。
- R2：新增 FastAPI API 层，只调用 `learning_ext` service 或学习层 Kotaemon adapter；API route 不导入 Gradio 页面对象，不把页面 handler 当作业务接口。
- R3：提供统一学习驾驶舱，主导航为今日、课程、复习、知识问答、资料库、学习进度、模型配置和使用帮助；未完成测验不作为可用主入口。
- R4：首页按状态只突出一个主要下一步：未配置模型时连接 AI，未创建项目时创建学习计划，已有项目时继续下一可学节点，并显示到期复习数。
- R5：课程区域包含继续学习、学习计划和项目管理；用户不需要手填项目 ID，导入导出、审计和删除不占据路线生成首屏。
- R6：长学习路线使用阶段/节点目录和独立滚动正文；节点详情默认折叠，点击目录定位并突出目标节点，不能再把所有节点描述平铺成整页长文。
- R7：学习工作台以正文为主，课程目录可收纳，AI 助教为按需抽屉；保留教学内容、实操、笔记、参考资料、划词解释和节点状态。
- R8：模型配置、知识问答、学习计划/项目管理、学习工作台、复习、看板、资料库和帮助全部由 React 呈现并使用统一组件、视觉 token、文案和状态模式。
- R9：AI 对话、RAG 回答、路线/课程准备进度和文件索引通过统一 SSE 协议输出；客户端支持取消，服务端识别断开并停止继续推送。
- R10：SSE 事件类型固定为 `start`、`progress`、`delta`、`citation`、`result`、`error`、`done`；所有事件 data 均为 JSON，不混入未定义文本帧。
- R11：学习路线 JSON 不以未完成 token 形式暴露给 UI；服务端流式发送阶段进度，最终通过 `result` 返回完整且已校验的路线。
- R12：Kotaemon RAG 通过无 Gradio 依赖的学习层 adapter 提供对话、引用和资料索引；不修改 Kotaemon 子模块。
- R13：生产模式由 FastAPI 同源提供 `/api` 与 React 静态资源；开发模式由 Vite dev server 代理 `/api`。旧 Gradio Web、`/legacy` 和学习页面组装代码全部移除。
- R14：便携版用户运行时不需要 Node/npm；构建产物随 `learning_ext` 一起打包。Node 仅是开发/构建依赖。
- R15：视觉概念保持“学习轨迹”：深墨蓝正文、靛蓝行动色、薄荷绿完成态、琥珀色复习态和低对比背景；减少无意义 emoji、渐变与卡片嵌套。
- R16：1280×720 及以上桌面视口完整可用，约 960px 窄视口可用；键盘焦点可见，尊重 reduced-motion。
- R17：不改变现有数据库 schema、路线算法、FSRS 调度语义或本地数据位置；API schema 与 ORM 模型解耦。
- R18：所有 API 使用服务端确定的本地用户身份，并在项目、节点、卡片、会话、文件和分组边界执行归属校验；外部对象与不存在对象统一返回 404。
- R19：本地 HTTP 服务必须限制 Host/Origin，所有错误和日志必须脱敏；文件下载只能从授权资源 ID 解析，URL 索引必须阻止内网、loopback、link-local 和带凭据目标。
- R20：文件索引取消/失败需补偿清理本次新建的部分产物；API 禁用无法可靠等待和取消的 quick index 模式，强制 reindex 的非原子限制必须明确提示。
- R21：模型配置逻辑移出 Gradio 页面并修正现有 embedding manager 热更新错误，保存成功后对话与 RAG 配置即时生效且不回显密钥。

## Acceptance Criteria

- [ ] 启动器启动单个本地 FastAPI 服务后，根 URL 加载 React 驾驶舱，`/api/health` 可用，`/legacy` 返回 404，生产启动不导入 LearningApp、learning_ext.pages 或 Gradio。
- [ ] 新用户可不查帮助完成“连接 AI → 创建路线 → 保存项目 → 开始第一节课”。
- [ ] 已有项目用户打开首页可看到当前项目、下一节点、总体进度和到期复习数，并一键继续学习。
- [ ] React 主导航只展示已定义的八个入口；未完成测验不伪装成可用功能。
- [ ] 创建/选择项目、进入课程、复习、看板和资料操作均不要求手工输入项目 ID。
- [ ] 含 50 个节点的路线能在固定内容区域内浏览，可从阶段/节点目录定位任意节点，课程编号顺序正确，长路线不会撑高整个应用页面。
- [ ] 路线标题和描述按纯文本渲染；LLM 返回的 HTML 或脚本不能执行。
- [ ] 1280×720 下工作台正文拥有主要宽度，课程目录与 AI 助教不会同时固定挤压正文；核心操作无水平滚动。
- [ ] AI 对话能逐段显示输出，RAG 引用通过独立 `citation` 事件呈现；用户取消后前端停止更新，后端结束流。
- [ ] 路线生成显示阶段进度，完成后一次性呈现有效路线；不会把半截 JSON 显示给用户。
- [ ] 文件上传和索引能显示逐文件/逐阶段进度，列表、筛选、下载和删除确认可用。
- [ ] 模型配置 API 不向前端返回已保存 API key，日志和 SSE 错误事件不泄露密钥。
- [ ] 非本地 Host/Origin 的写请求被拒绝；伪造其他对象 ID 不能读取或修改项目、节点、会话、卡片、文件或分组。
- [ ] 索引失败或取消不会遗留本次新增的孤儿 SQL、文件、docstore 或 vectorstore 产物；`done` 不会早于 embedding 完成。
- [ ] 保存模型配置后，对话模型和正确的 embedding manager 均完成热更新；状态响应不包含 API key。
- [ ] React 页面覆盖今日、课程、复习、知识问答、资料库、学习进度、模型配置和帮助，不存在默认路径跳回旧 Gradio 页面。
- [ ] Windows 便携版包含构建后的前端资源且运行时不依赖 Node；macOS 浏览器入口仍可启动。
- [ ] Python 目标测试、API 测试、前端单元测试、生产构建和端到端主路径测试通过，并完成三种视口全量视觉走查。

## Out of scope

- Next.js、服务端渲染、SEO 或公网多租户部署。
- 本任务内迁移到 Tauri/Electron；继续使用浏览器/PyWebView 桌面壳。
- 修改 `kotaemon/` 子模块或替换 Kotaemon 的 RAG、解析、向量存储实现。
- 修改数据库 schema、FSRS 算法、路线生成提示词目标或实现尚未完成的测验业务。
- Kotaemon 自带 Gradio UI 的迁移或维护；本产品只保留 headless RAG/index runtime。
- 语音实时通话、多人协作等需要 WebSocket 的能力。

## Key decisions

- 用户选择全部页面重绘，并批准从 Gradio 默认前端切换为 React/Vite + FastAPI 前后端分离。
- 使用 Vite SPA 而非 Next.js；本地桌面应用不需要 SSR/SEO。
- 流式传输使用基于 POST fetch 的 SSE；当前单向 AI/进度流不引入 WebSocket。
- React 为唯一产品界面；完成能力对齐后删除 Gradio 回退，并由 headless Kotaemon context 提供 RAG/index runtime。
- 长路线使用真实阶段目录、节点定位和折叠详情，延续“学习轨迹”作为唯一视觉签名。

## Technical notes

- 任务属于跨前端、API、Kotaemon adapter 和桌面打包的复杂重构，技术设计与执行顺序见同目录 `design.md`、`implement.md`。
- 规划基线中页面/看板目标测试为 40 passed、3 failed；失败来自测试绕过启动入口的 tiktoken 离线降级。全量 Ruff 有 29 个既存问题，实施需修复新测试入口并确保触及文件零新增问题。
