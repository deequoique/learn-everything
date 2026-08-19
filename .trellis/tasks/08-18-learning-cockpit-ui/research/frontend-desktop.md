# Research: frontend and desktop implementation

- Query: Determine an executable React/Vite frontend and desktop-hosting plan for the approved learning cockpit, including long-roadmap UX, POST SSE consumption, launcher/PyWebView integration, and build-only Node packaging.
- Scope: internal (repository and locally installed framework versions); no network sources were consulted.
- Date: 2026-08-18

## Findings

### Recommended decisions

1. Put the standalone frontend at `learning_ext/web/` and keep all browser code independent of `learning_ext/pages`. The approved boundary already requires API routes not to import Gradio pages (`prd.md:21-34`; `design.md:31-62`).
2. Use React Router with browser-history routes, TanStack Query for REST server state, a small project-selection context for UI context, and feature-local reducers for active streams. Do not add Redux/Zustand for the first version.
3. Use relative URLs everywhere in the browser. Vite proxies `/api` and `/legacy` in development; FastAPI serves both plus the built SPA in production. This makes browser and PyWebView behavior identical and avoids production CORS.
4. Consume POST SSE with `fetch`, not `EventSource`: `EventSource` cannot carry the required JSON POST body. Use one shared incremental parser, runtime event validation, one exhaustive reducer, and `AbortController`.
5. Render 50 roadmap nodes without virtualization. The dominant content is collapsed, 50 headers are inexpensive, and keeping all anchors mounted makes directory navigation deterministic. Reassess virtualization only with measured routes in the hundreds.
6. Keep the existing two-process desktop model. Rename Gradio-specific launcher functions, pass the selected host/port to Uvicorn, and replace TCP readiness with `GET /api/health` plus early child-process-exit detection.
7. Build the web app before packaging and copy `learning_ext/web/dist`, but exclude `node_modules`. A portable runtime must never invoke `node` or `npm`.

### Files found

| Path | Relevant existing behavior |
|---|---|
| `custom_app.py:12-77` | Resolves the project root, configures offline/cache environment, and adjusts `sys.path`; the FastAPI factory must preserve this initialization order. |
| `custom_app.py:80-124` | Builds and launches Gradio at import time. Replace the terminal `demo.launch()` with an import-safe app factory, queued legacy Blocks, `gr.mount_gradio_app(..., path="/legacy")`, and an explicit `uvicorn.run()` only under `__main__`. |
| `learning_ext/app.py:311-356` | `LearningApp.make()` returns the Blocks object needed by `gr.mount_gradio_app`; the legacy CDN dependencies remain a legacy/offline caveat. |
| `learning_ext/app.py:459-540` | Confirms the current all-tabs Gradio surface and the pages that must become React routes. |
| `learning_ext/pages/path_generator.py:45-171` | Confirms the current route creator, long Markdown output, manual project IDs, and advanced operations share one page. |
| `learning_ext/pages/path_generator.py:716-769` | The old renderer flattens every node description into one Markdown document and hard-codes three stages. It should not be reused by React. |
| `learning_ext/progress/study.py:57-69` | `course_code_sort_key` is the authoritative numeric-aware order (`2.10` after `2.9`); API results should already be sorted with it. |
| `learning_ext/path_generator/service.py:357-395` | `load_roadmap` returns sorted nodes but currently omits database node IDs. The API DTO must include a stable `node_id`; React must not use array indexes as keys/anchors. |
| `learning_ext/db/models.py:20-62` | Project and node IDs/statuses exist; no schema change is needed for routing or roadmap navigation. |
| `launcher.py:58-90` | Frozen launcher resolves runtime files relative to the executable and locates platform-specific Kotaemon venv Python. Preserve this contract. |
| `launcher.py:111-174` | Port selection and backend subprocess already exist. Current readiness is only a TCP connect and backend environment variables are Gradio-named. |
| `launcher.py:177-253` | PyWebView/browser fallback already opens one local URL and terminates the child after the desktop window closes. The logged browser URL incorrectly hard-codes port 7860 at line 242. |
| `tests/test_launcher_paths.py:1-17` | Existing launcher coverage only tests venv path preference; add health, dynamic-port, early-exit, and cleanup tests here or in a sibling test file. |
| `setup.bat:25-45` / `setup_macos.sh:17-46` | Source setup currently installs only Python dependencies. A source checkout will need a separate explicit web-build step if `dist` is absent. |
| `build_exe.bat:21-39` | Builds only the launcher executable; it does not need Node or embed the SPA because `custom_app.py` remains an external child-process entry. |
| `pack_portable.bat:23-39` | Copies all of `learning_ext`, which would also copy `web/node_modules`. The portable step must build first and exclude Node dependencies/caches. |
| `.gitignore:8,17-18` | `node_modules`, `build`, and every `dist` directory are ignored, so `learning_ext/web/dist` cannot be assumed to exist after checkout. Packaging must create and verify it. |
| `run_macos.sh:4-14` | macOS currently supports source/browser launch, not a self-contained portable application. |
| `kotaemon/libs/kotaemon/pyproject.toml:30-31,64` | Repository pins FastAPI `<=0.112.1`, Gradio `<5`, and Pydantic `<=2.10.6`. Local environment is FastAPI 0.112.1, Gradio 4.39.0, Uvicorn 0.37.0. |

### Frontend placement and module shape

Use this structure; feature folders own their UI and query hooks, while cross-feature transport contracts have one owner:

```text
learning_ext/web/
├── package.json
├── package-lock.json
├── vite.config.ts
├── playwright.config.ts
├── tsconfig*.json
├── eslint.config.js
├── index.html
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   ├── queryClient.ts
│   │   ├── AppShell.tsx
│   │   └── ProjectContext.tsx
│   ├── api/
│   │   ├── client.ts
│   │   ├── contracts.ts
│   │   ├── stream.ts
│   │   └── streamReducer.ts
│   ├── components/
│   │   ├── AsyncState/
│   │   ├── Dialog/
│   │   ├── Drawer/
│   │   └── Markdown/
│   ├── features/
│   │   ├── home/
│   │   ├── courses/
│   │   │   ├── RoadmapExplorer.tsx
│   │   │   ├── RoadmapOutline.tsx
│   │   │   ├── RoadmapNode.tsx
│   │   │   └── roadmap.test.tsx
│   │   ├── review/
│   │   ├── chat/
│   │   ├── library/
│   │   ├── dashboard/
│   │   ├── settings/
│   │   └── help/
│   ├── styles/{tokens,reset,shell}.css
│   └── test/{setup,factories}.ts
├── e2e/
└── dist/
```

Suggested routes:

```text
/                                  Today/home
/courses                           Continue learning
/courses/plan                      Roadmap browser/generator
/courses/projects                  Project management
/courses/:projectId/nodes/:nodeId  Workbench deep link
/review
/chat
/library
/dashboard
/settings
/help
```

Database IDs may be opaque route parameters, but must never be manually entered. Links and project selectors produce them. Initialize the selected project from the home payload (most recently updated active project), optionally remember only the non-sensitive project ID in local storage, validate it against `GET /api/projects`, and fall back when it no longer exists. Never persist API keys, SSE payload history, or model credentials in browser storage.

### Development proxy and production static serving

Vite should bind only to loopback and use a strict port. Keep browser calls relative:

```ts
server: {
  host: "127.0.0.1",
  port: 5173,
  strictPort: true,
  proxy: {
    "/api": { target: "http://127.0.0.1:7860" },
    "/legacy": { target: "http://127.0.0.1:7860", ws: true },
  },
}
```

Allow an environment override for the proxy target when the backend chose a fallback port. The normal dev scripts should select a known free backend port and pass the same value to Vite. With relative proxy calls, CORS is unnecessary; if direct Vite-to-backend requests are intentionally supported, allow only exact `http://127.0.0.1:5173` and `http://localhost:5173` origins in development.

Production registration order is contractual:

1. FastAPI middleware and `/api/*` routes.
2. Queued Gradio Blocks mounted at `/legacy` with the existing allowed paths.
3. `/assets` static mount from `learning_ext/web/dist/assets`.
4. A final GET-only SPA fallback that serves a real file inside `dist` or `index.html` for browser routes.

Do not rely on `StaticFiles(html=True)` alone: it does not provide an arbitrary React Router deep-link fallback. The fallback must resolve candidate paths under `dist` and reject traversal. Unknown `/api/*` and `/legacy/*` paths must remain 404 rather than returning SPA HTML. Serve hashed `/assets/*` with long immutable caching and `index.html` with `no-store` to prevent stale asset references.

If `dist/index.html` is absent, keep `/api/health` and `/legacy` available but return a clear 503/build instruction at `/`; do not silently make legacy the default. Resolve `dist` from `Path(__file__)`, never from the process CWD, because launcher deliberately runs the child with `cwd=kotaemon` (`launcher.py:151-154`).

### REST and UI state ownership

- TanStack Query owns projects, roadmap, node, review, dashboard, library, and configuration status responses. Query keys should be factories, e.g. `projectKeys.roadmap(projectId)`, rather than ad hoc arrays.
- Router state owns the visible section, project/node deep links, and shareable filters.
- Component state owns open dialogs, drawers, accordion expansion, draft fields, and scroll synchronization.
- `ProjectContext` owns only the selected project ID and selection action; all project data still comes from Query.
- Stream state remains local to its feature until `result`/`done`; then invalidate or set the relevant query cache. Never append token deltas directly into the canonical REST cache.
- Decode unknown API JSON once in `api/contracts.ts` (for example with Zod). Components must not repeat casts of event or response fields.

### POST SSE client contract

`src/api/stream.ts` should expose one primitive such as `streamJson(url, body, {signal, onEvent})`. It must:

1. `fetch` with `POST`, JSON content type, `Accept: text/event-stream`, and the caller's `AbortSignal`.
2. Reject non-2xx responses before reading the body and reject a missing body.
3. Incrementally decode arbitrary byte chunks with one `TextDecoder(..., {stream:true})`; chunk boundaries are not event boundaries and may split UTF-8 Chinese characters.
4. Parse complete SSE records separated by a blank line, handling CRLF, comments, `id`, `event`, and multiple `data:` lines. A small dedicated parser dependency is safer than feature-specific string splitting.
5. JSON-decode and runtime-validate exactly `start`, `progress`, `delta`, `citation`, `result`, `error`, and `done`.
6. Feed one exhaustive reducer in `streamReducer.ts`. Unknown events are protocol errors, not ignored feature by feature.
7. Stop immediately on `error` or `done`, cancel the reader in `finally`, and treat `AbortError` as user cancellation rather than a failure toast.

Do not auto-reconnect a failed POST stream: generation/indexing operations are not proven idempotent and the protocol has no durable resume store. The UI may offer an explicit retry. Sequence IDs can detect duplicates within one connection but do not imply resume support.

Unit tests must feed the parser one byte at a time, split `\r\n\r\n` across chunks, split a multibyte Chinese character, combine multiple events in one chunk, send malformed JSON, abort mid-event, and verify the reducer's terminal-state rules. Feature tests must verify chat delta concatenation, citation de-duplication, roadmap `progress` without partial JSON, and cache invalidation only after a valid result.

### 50-node roadmap UX

The page's single job is orientation: show where the learner is, let them jump to any node, and reveal detail on demand. The signature element should be the real learning trajectory—stage rail, node code, status, and dependency—not a generic metric-card hero.

Desktop geometry:

```text
app shell: height: 100dvh; overflow: hidden
main: min-width: 0; min-height: 0
roadmap workspace: grid 280px minmax(0, 1fr); min-height: 0
outline: overflow-y: auto
content: overflow-y: auto; scroll-padding-top: 24px
```

At the compact breakpoint (approximately 960px), replace the fixed outline with a drawer opened by a persistent “课程目录” control; keep the content scroller and never create body-level horizontal scrolling.

Behavior:

- Group the outline by API-provided stage order; show stage name, completed/total count, and node code/title/status. Do not hard-code only `base/strengthen/sprint` in React.
- Keep all 50 node headers mounted. Each header is a real `button` controlling an accessible detail region. Default all details closed except the current learning node.
- A directory click first expands the target if appropriate, then after render calls `scrollIntoView({block:"start"})`. Use smooth behavior only when reduced motion is not requested.
- An `IntersectionObserver` rooted at the content scroller updates the active directory item while the user scrolls. Use a top-biased root margin and a deterministic tie-break (closest visible heading to the top).
- Keep the active directory entry visible within its own scroller with `block:"nearest"`; do not scroll the document.
- Render titles/descriptions as React text. For lesson Markdown, configure the renderer to skip raw HTML and never enable a raw-HTML plugin (`prd.md:46-49`).
- For saved nodes, anchors and React keys use `node_id`. Generated unsaved drafts may use a validated unique course code scoped to the draft, never array position.

Required tests:

- API contract: a 50-node fixture is numerically sorted (`2.1`, `2.2`, `2.10`) and every persisted node has a stable ID.
- Vitest/Testing Library: 50 outline entries map one-to-one to 50 headings; stage counts/statuses render; details are collapsed; a directory click expands/locates the correct node; mocked observer changes active state; reduced motion disables smooth scroll; malicious HTML remains inert.
- Playwright: at 1440x900, 1280x720, and approximately 960px, navigate to node 50, verify it is visible and highlighted, verify the route page itself does not grow to 50-node document height, and verify there is no horizontal overflow. Also keyboard-test outline, accordion, drawer, Escape, and focus return.

### Launcher and PyWebView integration

Preserve `BASE_DIR`, venv discovery, subprocess logging, browser fallback, and child cleanup. Change only the backend semantics:

- Rename `start_gradio_backend` to `start_backend` and set a backend-neutral host/port contract (or temporarily read both `LE_SERVER_*` and current `GRADIO_SERVER_*` variables for compatibility).
- `custom_app.py` should call `uvicorn.run(app, host=host, port=port)` only when executed as a script. Importing its factory in pytest must not start a server.
- Change readiness to `GET http://127.0.0.1:<port>/api/health`, require a 200 response and expected JSON, and stop waiting if `proc.poll()` reports an exit. A bare open TCP port can belong to another process or precede application readiness (`launcher.py:123-132`).
- Use the selected dynamic `url` in every log and browser/PyWebView call; remove the hard-coded 7860 message (`launcher.py:225-242`).
- Keep PyWebView optional and browser mode the default (`launcher.py:228-241`). If the product promises the approximately 960px layout in the window, reduce the current `min_size=(1024,700)` only after the 960px Playwright layout passes.
- Test shutdown after normal PyWebView close, browser Ctrl+C, startup timeout, and early backend exit. Mock HTTP/process calls; launcher unit tests must not open a real browser.

### Build-only Node and packaging

Use an npm lockfile and declare Node `>=20.19.0`; the local machine is Node 20.20.2/npm 10.8.2. Node is a source-development/release-build prerequisite, not an application runtime dependency.

Recommended release flow:

1. `build_web.bat` / `build_web.sh`: verify Node version, run `npm ci`, run frontend tests as appropriate for CI, run `npm run build`, and assert `learning_ext/web/dist/index.html` exists.
2. `build_exe.bat`: continue to package the launcher only.
3. `pack_portable.bat`: call the web build (or require a verified prebuilt artifact), then copy runtime files. Exclude `learning_ext/web/node_modules`, test output, coverage, `__pycache__`, and `*.pyc`. If using `robocopy`, remember exit codes 0-7 are success and 8+ are failure.
4. Add a post-copy assertion for `%PORTABLE%\learning_ext\web\dist\index.html` and assertions that `%PORTABLE%\learning_ext\web\node_modules` and `node.exe` do not exist.
5. Smoke-start the portable executable on a clean Windows machine/VM with Node removed or absent; check `/api/health`, `/`, a deep React route, and `/legacy/`.

The current macOS workflow is source/browser mode, not portable distribution (`README.md:18-25`; `run_macos.sh:1-14`). `setup_macos.sh` may run the web build for source users, but a distributable macOS artifact must be built per architecture and must not copy the current venv: the inspected venv Python is a symlink to a machine-specific `/Library/Frameworks/...` interpreter. Treat macOS portable packaging as a separate deliverable unless task scope is explicitly expanded. For this task, validate the existing macOS source/browser entry with a prebuilt or locally built `dist`.

### Exact validation commands

Run from the repository root after implementation. The package scripts named below should be created exactly so local and CI commands stay stable.

```bash
# Frontend dependency and static checks
cd learning_ext/web
npm ci
npm run typecheck
npm run lint
npm run test -- --run
npm run build
test -f dist/index.html

# Browser tests (install is a build-machine step, never a portable runtime step)
npx playwright install chromium
npm run test:e2e -- --project=chromium
cd ../..

# Focused Python/API/launcher coverage
kotaemon/.venv/bin/python -m pytest \
  tests/test_api_app.py \
  tests/test_api_streaming.py \
  tests/test_launcher_paths.py -q

# Existing roadmap ordering and page/service regression
kotaemon/.venv/bin/python -m pytest \
  tests/test_path_generator.py \
  tests/test_progress_study.py \
  tests/test_pages.py -q

# Full local Python suite (real-provider tests remain opt-in per existing convention)
kotaemon/.venv/bin/python -m pytest tests -q

# Touched Python quality gate; expand this list as API/adapter files are added
kotaemon/.venv/bin/python -m ruff check \
  custom_app.py launcher.py learning_ext/api tests/test_api_app.py \
  tests/test_api_streaming.py tests/test_launcher_paths.py

# macOS source/browser smoke (manual close after checks)
./run_macos.sh
curl -fsS http://127.0.0.1:7860/api/health
curl -fsS http://127.0.0.1:7860/courses/plan >/dev/null
curl -fsS http://127.0.0.1:7860/legacy/ >/dev/null
```

Windows release validation must be run in `cmd.exe` on Windows, not emulated on macOS:

```bat
call build_web.bat
call build_exe.bat
call pack_portable.bat
if not exist "dist\LearnEverything-Portable\learning_ext\web\dist\index.html" exit /b 1
if exist "dist\LearnEverything-Portable\learning_ext\web\node_modules" exit /b 1
where node >nul 2>&1
REM Final clean-VM smoke must also be performed with Node absent from PATH.
```

For the running portable build, verify the dynamically logged port rather than assuming 7860 when that port is occupied.

### Related specs and approved task contracts

- `.trellis/spec/guides/cross-layer-thinking-guide.md`: define and decode API/SSE contracts once at the boundary; do not cast fields in each component.
- `.trellis/spec/guides/code-reuse-thinking-guide.md`: use one event reducer/parser and query-key factories rather than repeated event field extraction.
- `.trellis/spec/kotaemon/frontend/*.md`: present but still placeholder-only; they provide no established React conventions. This research supplies task-local executable conventions and should later inform a spec update.
- `.trellis/tasks/08-18-learning-cockpit-ui/prd.md:19-55`: authoritative requirements and acceptance criteria.
- `.trellis/tasks/08-18-learning-cockpit-ui/design.md:31-62,186-224`: approved package boundary, frontend stack, long-roadmap behavior, and desktop integration.
- `.trellis/tasks/08-18-learning-cockpit-ui/implement.md:44-90`: approved frontend, long-roadmap, host, launcher, packaging, and validation work order.

### External references and versions

- No web/network documentation was used. Local installed APIs were inspected directly.
- `gradio.mount_gradio_app` exists in installed Gradio 4.39.0 and accepts a FastAPI app, Blocks, mount path, allowed paths, and related options. It installs the Gradio lifespan and mounts a sub-application; create/mount it before the SPA catch-all.
- Installed FastAPI is 0.112.1, Pydantic is repository-pinned at `<=2.10.6`, Uvicorn is 0.37.0, Node is 20.20.2, npm is 10.8.2, pytest is 8.4.2, and Ruff is 0.15.4.
- The approved plan's Node 20.19+ floor is compatible with the inspected build machine (`implement.md:45`). The lockfile, not an unpinned “latest” instruction, must define frontend dependency versions.

## Caveats / Not Found

- There is no existing `learning_ext/web`, JavaScript lockfile, React test setup, or CI workflow to reuse; all frontend conventions are new and must be locked in the first implementation slice.
- The frontend spec files under `.trellis/spec/kotaemon/frontend/` are placeholders, so they cannot resolve library/style choices.
- `load_roadmap()` does not expose `KnowledgeNode.id` and reconstructs stage metadata with machine names; the API must correct both DTO concerns without changing the database schema.
- The repository ignores all `dist` directories, so a source checkout cannot serve React until it has been built. This is compatible with Node-at-build-only portable distribution only if release scripts enforce the build artifact.
- Current macOS support is source/browser launch only. No macOS portable builder, signed `.app`, notarization flow, universal binary, or relocatable Python runtime exists; do not claim macOS portable support in this task without explicit scope expansion.
- Windows batch packaging cannot be executed or proven on this macOS host. Its final gate requires a Windows clean-machine/VM smoke test with Node absent.
- Legacy Gradio loads several browser assets from public CDNs (`learning_ext/app.py:322-332`), so `/legacy` is not fully offline even though the new React shell can be. This does not block the default SPA but should remain visible as a legacy limitation.
