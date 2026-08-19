# React-only Hosting and Headless Kotaemon Runtime

## Scenario: Serve the learning cockpit without constructing UI frameworks

### 1. Scope / Trigger

- Trigger: changing `custom_app.py`, `learning_ext/api/app.py`, or Kotaemon adapter startup.
- The shipped product has one UI: the built React SPA under `learning_ext/web/dist`.
- Kotaemon remains the RAG/indexing engine, but production startup must not construct Gradio Blocks, page selectors, or `LearningApp`.

### 2. Signatures

- `custom_app.create_production_app() -> FastAPI`
- `learning_ext.kotaemon_adapter.HeadlessKotaemonContext() -> context manager/runtime resources`
- `GET /api/health -> {"status": "ok", "api_version": "1", "frontend": bool}`
- `GET /legacy` and `GET /legacy/ -> 404`

### 3. Contracts

- API routes are registered before the SPA fallback.
- Production startup may import Kotaemon services, settings, index resources, indexing pipelines, retrievers, and reasoning pipelines.
- Production startup must not import `learning_ext.app`, `learning_ext.pages`, `ktem.pages`, or `gradio`.
- The headless context must initialize the configured settings, reasoning registry, index resources, indexing pipelines, and retrievers without calling Kotaemon UI lifecycle methods.
- The portable package must contain `learning_ext/web/dist/index.html` and exclude `learning_ext/web/node_modules`.
- Node.js is a build-time dependency only.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| SPA build missing in production | Fail with an actionable frontend-build error; do not silently mount an old UI |
| Headless Kotaemon resource initialization fails | Startup fails before reporting healthy |
| Unknown `/api/*` route | Return API 404; never serve `index.html` |
| React deep link such as `/courses/plan` | Return the SPA `index.html` |
| `/legacy` or `/legacy/` | Return 404 |
| Runtime imports a UI module | Import-guard test fails |

### 5. Good / Base / Bad Cases

- Good: `create_production_app()` initializes a `HeadlessKotaemonContext`, exposes API + SPA, and imports no UI framework.
- Base: tests inject a lightweight runtime/session factory and validate routes without initializing external providers.
- Bad: constructing `LearningApp().make()`, calling `IndexManager.on_application_startup()` when it loads selector pages, or retaining `/legacy` as a hidden fallback.

### 6. Tests Required

- Import guard: after real headless initialization, assert `gradio`, `learning_ext.app`, `learning_ext.pages`, and `ktem.pages` are absent from `sys.modules`.
- Production route smoke: assert `/api/health` is 200, a React deep link is 200, and both legacy paths are 404.
- Adapter contract: assert reasoning, retriever, and indexing resources are available without page objects.
- Packaging: assert `dist/index.html` exists and `node_modules` is excluded.
- Run full Python tests, touched-scope Ruff, TypeScript, ESLint, Vitest, and the production Vite build.

### 7. Wrong vs Correct

#### Wrong

```python
legacy = LearningApp()
blocks = legacy.make().queue()
app = mount_gradio_app(create_app(), blocks, path="/legacy")
```

This constructs the retired UI, imports page modules, slows startup, and keeps API behavior coupled to component state.

#### Correct

```python
def create_production_app():
    context = HeadlessKotaemonContext()
    runtime = context.start()
    return create_app(runtime=runtime)
```

The runtime owns only settings and RAG/indexing resources; FastAPI owns HTTP and React owns presentation.
