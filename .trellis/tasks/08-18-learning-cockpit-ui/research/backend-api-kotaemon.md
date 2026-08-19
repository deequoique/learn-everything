# Research: Backend API, SSE, and Kotaemon adapters

- Query: How should the approved React/Vite migration host FastAPI, bridge synchronous generators to cancellable SSE, expose Kotaemon chat/indexing without importing Gradio pages, enforce local-session/security boundaries, and test the result?
- Scope: internal / external
- Date: 2026-08-18

## Findings

### Recommended outcome

Implement the backend in four separable layers:

1. `learning_ext/api/app.py`: an injectable FastAPI factory, route registration, local-origin protection, `/legacy` mount, and SPA fallback.
2. `learning_ext/api/streaming.py`: the only SSE encoder and the only sync-generator-to-async bridge.
3. `learning_ext/kotaemon_adapter/`: headless chat, conversation, file, group, retrieval, and indexing operations. These modules may import Kotaemon pipeline/model classes but must never import `ktem.pages.*`, `learning_ext.pages.*`, `gradio`, or return `gr.update`/rendered HTML.
4. Existing/new `learning_ext` services: business orchestration and ownership-aware database operations. Routes should validate DTOs, resolve ownership, invoke a service/adapter, and map failures; they should not contain SQL or pipeline construction.

The implementation must not call `ChatPage.create_pipeline()`, `ChatPage.chat_fn()`, `FileIndexPage.index_fn()`, or `FileIndex.get_retriever_pipelines()`. The first three are UI handlers. The last one also has a hidden UI dependency through `_selector_ui.get_selected_ids()` (`kotaemon/libs/ktem/ktem/index/file/index.py:462-486`).

### Files found

- `custom_app.py:12-77` — process bootstrap, offline/tiktoken setup, placeholder credentials, and Kotaemon import-path setup that must still occur before importing API/Kotaemon runtime modules.
- `custom_app.py:110-124` — current import-time `LearningApp` construction and blocking `demo.queue().launch()`; this is the host seam to replace.
- `launcher.py:111-174` — port selection, TCP-only readiness check, and Gradio-named backend process launcher.
- `launcher.py:205-252` — browser/PyWebView lifecycle already matches a local HTTP child process and can remain structurally unchanged.
- `learning_ext/app.py:459-550` — legacy UI construction; only the host may construct it for `/legacy`.
- `learning_ext/llm/client.py:98-185` — existing OpenAI-compatible sync token iterator; it lacks an explicit `finally: response.close()` cleanup path.
- `learning_ext/pages/quick_setup.py:57-160` — model configuration logic is embedded in a Gradio page and must move to a non-page service.
- `learning_ext/pages/quick_setup.py:148-155` — the runtime embedding update imports nonexistent `ktem.embeddings.manager.embeddings`; the actual singleton is `embedding_models_manager` (`kotaemon/libs/ktem/ktem/embeddings/manager.py:226`). RAG configuration is therefore not reliably hot-applied today.
- `kotaemon/libs/ktem/ktem/app.py:66-93` — Kotaemon app initialization owns flattened defaults and `IndexManager`; these are runtime inputs the adapter needs.
- `kotaemon/libs/ktem/ktem/app.py:175-220` — `make()` creates all Gradio pages and events; adapters must not require this to have run.
- `kotaemon/libs/ktem/ktem/pages/chat/__init__.py:223-275` — `ChatPage` creates selector UIs and dynamically attaches `index.selector`/`index.default_selector`. These fields do not exist in a headless runtime.
- `kotaemon/libs/ktem/ktem/pages/chat/__init__.py:1182-1278` — reusable reasoning/retriever construction logic is mixed into `ChatPage` and must be reproduced as a small learning-layer adapter, not invoked as a page method.
- `kotaemon/libs/ktem/ktem/pages/chat/__init__.py:1296-1408` — UI chat generator concatenates `Document(channel="chat")`, rendered `info` HTML, Gradio plot updates, and mutable state.
- `kotaemon/libs/ktem/ktem/reasoning/simple.py:281-331` — default RAG pipeline is a synchronous generator: retrieve, token stream, then citation/add-on output.
- `kotaemon/libs/ktem/ktem/reasoning/simple.py:341-395` — public `get_pipeline(settings, state, retrievers)` is the headless construction seam.
- `kotaemon/libs/ktem/ktem/reasoning/simple.py:150-164` — retrieved documents are converted to UI HTML before being emitted on `channel="info"`; structured citations must be captured before this rendering step.
- `kotaemon/libs/ktem/ktem/utils/render.py:28-35` — useful citation metadata already exists as `file_name` and `page_label`.
- `kotaemon/libs/ktem/ktem/index/file/index.py:440-460` — `get_indexing_pipeline(settings, user_id)` is a usable headless indexing seam.
- `kotaemon/libs/ktem/ktem/index/file/index.py:462-486` — retriever factory is not headless because it dereferences `_selector_ui`.
- `kotaemon/libs/ktem/ktem/index/file/pipelines.py:810-866` — indexing emits per-file `debug` and `index` documents and returns `(file_ids, errors, docs)`.
- `kotaemon/libs/ktem/ktem/index/file/pipelines.py:604-656` — a source row and storage copy are created before extraction/chunking completes; cancellation/failure can leave partial artifacts unless the adapter compensates.
- `kotaemon/libs/ktem/ktem/index/file/ui.py:1210-1279` — page indexing contains `gr.Info`/`gr.Warning` and display-string aggregation and must not be reused.
- `kotaemon/libs/ktem/ktem/index/file/ui.py:1470-1515` — current list logic correctly filters `Source.user` for private indices.
- `kotaemon/libs/ktem/ktem/index/file/ui.py:549-579` — current delete handler does not filter by user before deletion; it is unsafe as an API implementation.
- `kotaemon/libs/ktem/ktem/index/file/ui.py:1705-1740` — current validation covers configured size/count and URL prefix only; extension, ownership-aware count, path, and URL network-target validation need API-level coverage.
- `kotaemon/libs/ktem/ktem/index/file/ui.py:1800-1821` — “all files” selection applies private-index user filtering; the headless adapter must preserve this behavior.
- `kotaemon/libs/ktem/ktem/db/base_models.py:10-44` — existing conversation record can store messages, selected sources, and pipeline state without a schema change.
- `kotaemon/libs/ktem/ktem/pages/chat/__init__.py:1089-1148` — legacy persistence format and state behavior; page method itself lacks a strict ownership predicate and must not be called by the API.
- `learning_ext/path_generator/service.py:241-395` — roadmap export/load/replace take only project IDs; API ownership resolution must precede these calls.
- `learning_ext/progress/study.py:72-82` — node status mutation takes only node ID; route/service ownership resolution is mandatory.
- `learning_ext/notes/service.py:39-61` — note save accepts both node and project IDs without validating their relationship/ownership.
- `kotaemon/libs/ktem/ktem/db/engine.py:1-4` — the application uses a single global SQLite engine.
- `tests/conftest.py:29-75` — existing isolated SQLite pattern is reusable, but cleanup currently omits some newer tables and is not sufficient for API/Kotaemon adapter tests.
- `pack_portable.bat:27-39` — the whole `learning_ext` directory is copied, so a checked-in/built `web/dist` will be included; the script still needs an explicit “dist exists” gate.

### FastAPI host contract

Use an injectable factory rather than constructing heavy globals in a module imported by tests:

```python
def create_app(
    *,
    runtime: KotaemonRuntime | None = None,
    session_factory: Callable[[], Session] | None = None,
    web_dist: Path | None = None,
    include_legacy: bool = True,
) -> FastAPI: ...
```

`KotaemonRuntime` should be a learning-layer dataclass/protocol containing only `index_manager`, a callable returning fresh flattened settings, and optional legacy app/blocks handles. API and adapter tests should inject fakes and set `include_legacy=False`; they must not import `custom_app.py` or build Gradio.

Production assembly in `custom_app.py` should be:

1. Run the existing environment/path/tiktoken bootstrap before Kotaemon imports.
2. Construct one `LearningApp`; its constructor initializes reasonings, indices, and default settings (`kotaemon/libs/ktem/ktem/app.py:66-93`).
3. Create FastAPI and attach runtime/session factories.
4. If legacy is enabled, call `legacy_app.make()`, then `demo.queue()`, then `gr.mount_gradio_app(..., path="/legacy")`. Gradio 4.39.0's mount helper installs the child lifespan and queue startup, so do not also call `launch()`.
5. Register `/api/*` before any catch-all SPA route.
6. Serve `/assets` with `StaticFiles`; use a GET-only SPA fallback that returns `index.html` for client routes while returning 404 for missing asset-like paths. Plain `StaticFiles(html=True)` is not a general React-router fallback.
7. Run `uvicorn.run(app, host=HOST, port=PORT, workers=1)`. Keep one worker because process globals, model managers, SQLite, and in-process stream locks are not multi-worker safe.

Use absolute legacy `allowed_paths`; Gradio's installed mount contract explicitly requires complete paths. Set `show_error=False` on `/legacy` in production. Preserve the word-lookup template patch only for legacy.

The launcher should retain the current child-process/window lifecycle but rename `start_gradio_backend` to `start_backend`, pass a generic host/port environment variable (with old `GRADIO_SERVER_*` fallback during migration), and poll `GET /api/health` until a 200 JSON response. A successful TCP connect is not application readiness (`launcher.py:123-132`).

Recommended health payload:

```json
{"status":"ok","api_version":"1","frontend":true,"legacy":true}
```

Do not expose filesystem locations, database URLs, model keys, tracebacks, or the complete Kotaemon settings dict.

### Database/session boundary

- Use server-derived `CURRENT_USER_ID = "default"` for this local single-user release. Never accept `user_id` in request bodies, query strings, or SSE metadata.
- Every REST unit of work owns one session and closes it before serialization. Prefer synchronous `def` routes for synchronous services, or execute the complete “open session → service → DTO → close” function in one worker thread. SQLAlchemy `Session` objects are not thread-safe.
- A streaming route must not use a yielded FastAPI `Session` dependency if the generator runs in another thread. The stream worker must create and close its own session inside that worker.
- Add resolver helpers such as `require_project(session, project_id, user_id)`, `require_node(...)`, `require_card(...)`, `require_conversation(...)`, and `require_file(index, file_id, user_id)`. Return 404 for both missing and foreign objects to avoid existence disclosure.
- Validate parent consistency before calling current services: `node.project_id == project.id`, note/resource project matches the node, card belongs to the user/project, and dashboard project belongs to the user.
- Do not directly expose SQLModel/SQLAlchemy/Kotaemon objects. Convert to explicit Pydantic response DTOs while the session is open.
- Serialize high-risk writers: one active stream per conversation, one indexing/delete operation per index, and one roadmap replacement/preparation operation per project. Return `409 RESOURCE_BUSY` rather than running conflicting mutations.

### Local HTTP security boundary

Binding to `127.0.0.1` is necessary but not sufficient because a malicious web page can target localhost.

- Add `TrustedHostMiddleware` for `127.0.0.1`, `localhost`, and the selected local port shape.
- Add a custom unsafe-method origin guard. For `POST`, `PUT`, `PATCH`, and `DELETE`, require `Origin` to be absent only for trusted non-browser/test clients, or equal to the current localhost origin / configured Vite dev origins. CORS headers alone do not prevent all cross-origin writes.
- Production is same-origin. Development CORS should list exact `http://127.0.0.1:<vite-port>` and `http://localhost:<vite-port>` origins, methods, and headers; do not use `*`.
- Consider a launcher-generated per-process token if the app later binds beyond loopback. It is not required for this loopback-only MVP if strict Host/Origin checks are implemented.
- Never echo a saved API key. `GET /api/config/status` should return only `configured`, provider/base URL, model names, and capability flags. Redact keys, `Authorization`, prompts, local file paths, and upstream response bodies from logs and SSE errors.
- All file access starts from an authorized file ID. Resolve the source row, then join its stored hash/path under the configured index storage root and verify `resolved_path.is_relative_to(storage_root.resolve())`. Never accept a download path from the client.
- Upload into a request-scoped temporary directory with server-generated filenames, stream-count the maximum bytes, check configured suffixes case-insensitively, cap file count, and clean the directory on success/error/cancel.
- URL indexing currently only checks `http` prefixes (`kotaemon/libs/ktem/ktem/index/file/ui.py:1734-1740`). Before enabling the API, reject credentials in URLs and loopback/private/link-local/multicast targets after DNS resolution. Redirect targets also need validation; if the underlying Kotaemon web reader cannot guarantee that, keep arbitrary URL ingestion behind an explicit feature flag and support file upload first.

### SSE wire contract

Use `StreamingResponse` with `media_type="text/event-stream"` and headers:

```text
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
```

Each frame is UTF-8 and exactly:

```text
event: <fixed-event-name>
id: <request-uuid>:<monotonic-sequence>
data: <compact JSON object>

```

The encoder must use JSON serialization, never string interpolation. Event and ID values are server-generated; reject CR/LF. `ensure_ascii=False` is acceptable. Fixed events and data contracts:

| Event | Required data |
| --- | --- |
| `start` | `request_id`, `kind`, optional safe metadata |
| `progress` | `phase`, `message`, optional `current`, `total`, `item_id` |
| `delta` | non-empty `text` |
| `citation` | `citation_id`, `file_id`, `title`, optional `page`, `snippet`, `score` |
| `result` | `kind`, complete validated `payload` |
| `error` | stable `code`, actionable `message`, `retryable` |
| `done` | `status="completed"`, `elapsed_ms`, optional safe usage |

Rules:

- Emit exactly one `start` first.
- Normal completion emits zero or more middle events, optional `result`, then exactly one `done`.
- Application failure after headers emits exactly one terminal `error` and no `done`.
- Client disconnect cannot receive a terminal event; it sets cancellation, closes the adapter eventually, and emits no more bytes.
- Perform cheap request/ownership/capability validation before returning `StreamingResponse`, so those failures use normal HTTP 4xx. Failures after streaming begins use SSE `error` while HTTP remains 200.
- Route generation emits only `progress` while JSON is being produced and one validated `result`; never emit JSON tokens as `delta`.

### Safe synchronous-generator bridge

Starlette 0.38.6 already races `stream_response()` with an ASGI disconnect listener and cancels the response task on `http.disconnect`. That only cancels the async consumer; it cannot interrupt a synchronous `next()` already blocked in an LLM, parser, or embedding call.

Use one owner worker per source iterator rather than concurrently calling `next()` and `close()` from different threads:

```text
async response generator
  ├─ create bounded AnyIO memory stream (capacity 1)
  ├─ create threading.Event cancel_requested
  ├─ task: anyio.to_thread.run_sync(worker, abandon_on_cancel=True)
  └─ receive mapped events and encode frames

worker (single owner thread)
  ├─ create Session / source iterator in this thread
  ├─ for item in iterator:
  │    if cancel_requested: break
  │    map item to typed event
  │    anyio.from_thread.run(send.send, event)
  └─ finally: iterator.close(); session.close(); adapter cleanup
```

The async generator's `finally` sets `cancel_requested` and closes its receive side. The worker catches cancellation/broken-resource exceptions and performs cleanup in its own thread. Use a bounded channel for backpressure. Do not call `generator.close()` concurrently while `next()` is executing; Python raises “generator already executing” and resource cleanup becomes nondeterministic.

`abandon_on_cancel=True` lets the response task stop waiting for the worker, but it does not kill the OS thread. Therefore cancellation is cooperative and bounded by the current blocking call. Every learning-layer loop must check the event before the next model call, file, node, or database mutation. Upstream clients should use finite connect/read timeouts. Enhance `learning_ext.llm.client._stream_iter()` with `try/finally` and call the OpenAI stream's `close()` when available (`learning_ext/llm/client.py:139-185`).

Do not create the source iterator in the async route if it captures a session. Pass an iterator factory to the bridge and create all thread-affine state inside `worker`.

### Headless Kotaemon chat adapter

Initial supported contract should deliberately be the default `simple` reasoning mode. Reject other modes with `UNSUPPORTED_REASONING` plus `/legacy` guidance until each has structured-event tests; ReAct/complex modes emit UI-oriented HTML and different sequencing.

Recommended request:

```json
{
  "conversation_id": "optional-existing-id",
  "message": "question",
  "source": {"mode": "all|selected|none", "file_ids": ["..."]},
  "language": "English|Chinese"
}
```

Do not accept arbitrary flattened Kotaemon settings, model identifiers, commands, web-search commands, raw pipeline state, or user IDs from the client. Construct settings from a fresh server-side `runtime.flatten_settings()` snapshot and apply an allowlisted language/citation override. Force mind map and citation visualization off for the first structured API version.

Pipeline construction inside the adapter:

1. Load/create the owned `Conversation` directly through a repository, not `ConversationControl`. Deep-copy its `data_source`; use `STATE`-equivalent `{ "app": {"regen": false} }` when absent.
2. Resolve source IDs against each index's `Source` table. For private indices require `Source.user == CURRENT_USER_ID`; for `all`, query only authorized IDs. Expand groups only after requiring group ownership, then revalidate every contained file ID.
3. Recreate the small headless part of `FileIndex.get_retriever_pipelines`: strip `index.options.<id>.`, call each `_retriever_pipeline_cls.get_pipeline(..., authorized_ids)`, then inject `Source`, `Index`, `VS`, `DS`, `FSPath`, and `user_id` as done at `kotaemon/libs/ktem/ktem/index/file/index.py:462-486`. Isolate this private-attribute use in one compatibility module and cover it with a contract test.
4. Obtain `reasoning_cls = ktem.components.reasonings["simple"]` and call its public `get_pipeline(settings, reasoning_state, retrievers)` (`kotaemon/libs/ktem/ktem/reasoning/simple.py:341-395`). Do not set the unused UI `asyncio.Queue`; synchronous `.stream()` already yields documents.
5. Iterate `pipeline.stream(message, conversation_id, history)` in the bridge worker. Map `channel="chat"` non-null content to `delta`. Ignore HTML `info` frames and `plot` in the MVP rather than sending raw HTML.
6. Capture structured retrieval documents before `FullQAPipeline` renders them. The least invasive approach is a learning-layer `RecordingRetriever(BaseComponent)` wrapper that delegates retrieval, records returned `RetrievedDocument`s, and delegates `generate_relevant_scores`. Emit one deduplicated `citation` per recorded `doc_id` using safe metadata/text. Never regex-parse Kotaemon's rendered HTML.
7. Accumulate assistant text server-side. On normal completion, persist user/assistant messages, selected IDs, structured citations, and updated pipeline state in one commit. On error/cancel, do not append a partial assistant turn. Reject a second concurrent stream for the same conversation with 409.

For UI parity, add explicit conversation REST endpoints even though the original design list omitted them:

- `GET /api/chat/conversations`
- `POST /api/chat/conversations`
- `GET /api/chat/conversations/{id}`
- `PATCH /api/chat/conversations/{id}` for title only
- `DELETE /api/chat/conversations/{id}`

Every query/mutation must include `Conversation.user == CURRENT_USER_ID`; several legacy page methods select by ID alone (`kotaemon/libs/ktem/ktem/pages/chat/control.py:275-290`, `397-403`), so they are not safe API repositories.

Citation payload should be bounded and text-only:

```json
{
  "citation_id":"<doc_id>",
  "file_id":"<metadata.file_id>",
  "title":"<metadata.file_name or evidence>",
  "page":"<metadata.page_label or null>",
  "snippet":"<plain text, capped e.g. 800 chars>",
  "score":0.82
}
```

### Headless Kotaemon library adapter

Use the `FileIndex` object and its resources, not `FileIndexPage`.

Recommended REST contracts:

- `GET /api/library/indices`
- `GET /api/library/files?index_id=&query=`
- `GET /api/library/files/{file_id}`
- `GET /api/library/files/{file_id}/download`
- `DELETE /api/library/files/{file_id}`
- `GET|POST|PATCH|DELETE /api/library/groups...` if groups remain in the React scope
- `POST /api/library/index/stream` with multipart files and/or a separately validated URL list

List/delete/download/group operations must reproduce private-index predicates themselves. Do not reuse `FileIndexPage.delete_event()` because it selects by file ID without user filtering (`kotaemon/libs/ktem/ktem/index/file/ui.py:549-579`). Deletion order should be: require authorized source, collect relation IDs, delete SQL relations/source in a transaction, then delete vector/docstore entries, then remove the stored file if no other authorized source references the same content hash. Return a structured cleanup warning if a non-SQL store deletion fails; do not pretend the operation was fully successful.

Indexing stream mapping:

- `debug` “Indexing [i/n]” / conversion / chunk / embedding / finish messages become normalized `progress` phases (`queued`, `extracting`, `chunking`, `embedding`, `finalizing`), not raw backend logs.
- `index` success/failure becomes per-file `progress`; the final returned IDs/errors become one `result` summary.
- Never place `file_path`, exception text, loader internals, or temporary paths in SSE.

Cancellation/failure is not transactionally safe in Kotaemon today: source, docstore, vectorstore, and relation rows are written incrementally (`kotaemon/libs/ktem/ktem/index/file/pipelines.py:604-656`). Process one file at a time in the adapter, record any pre-existing ID before starting, identify the newly-created ID, and on failure/cancel call a learning-layer compensating cleanup for only the new partial artifact. Cleanup must run in the worker's `finally` after the current blocking pipeline call returns. Do not delete the pre-existing item merely because a reindex attempt was cancelled; the current Kotaemon reindex path deletes it before replacement, so the UI should warn that forced reindex is non-atomic until a future Kotaemon-compatible staging strategy exists.

Disable `quick_index_mode` for the API. It spawns an unjoined embedding thread (`kotaemon/libs/ktem/ktem/index/file/pipelines.py:414-421`), which breaks accurate `done`, cancellation, and cleanup semantics.

### Config service extraction

Move provider metadata, env reading/writing, runtime manager updates, and connection testing out of `learning_ext/pages/quick_setup.py` into a non-Gradio service. Keep the legacy page as a thin caller.

- Write `.env` atomically via a sibling temporary file and replace; serialize updates with a process lock.
- Invalidate `learning_ext.llm` cache after success.
- Update `ktem.llms.manager.llms` and `ktem.embeddings.manager.embedding_models_manager` using their real APIs.
- Never log model specs because they contain API keys.
- `PUT /api/config` response contains capabilities/status only, not the submitted key.
- Connection test errors must be mapped to stable categories (`AUTH_FAILED`, `MODEL_NOT_FOUND`, `UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`) and must not return the upstream body verbatim.

### Error mapping

Recommended stable codes:

- `NOT_FOUND`, `VALIDATION_FAILED`, `RESOURCE_BUSY`
- `MODEL_NOT_CONFIGURED`, `AUTH_FAILED`, `MODEL_NOT_FOUND`
- `UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`, `STREAM_FAILED`
- `UNSUPPORTED_REASONING`, `RAG_NOT_CONFIGURED`
- `FILE_TYPE_UNSUPPORTED`, `FILE_TOO_LARGE`, `FILE_LIMIT_EXCEEDED`
- `FILE_INDEX_FAILED`, `FILE_CLEANUP_INCOMPLETE`, `URL_NOT_ALLOWED`

Log a server request ID with `logger.exception` where appropriate, but expose only the stable code and a Chinese actionable message. A sanitizer should recursively redact keys named `api_key`, `authorization`, `token`, and bearer-like strings before logging context.

### Concrete tests

#### Unit: `tests/api/test_streaming.py`

- Exact frame encoding for Chinese text, quotes, backslashes, and embedded newlines; data parses as one JSON object.
- Reject CR/LF in server event/id; monotonically increasing IDs.
- Sequence: `start → delta → done`; result stream: `start → progress* → result → done`; failure: `start → error` only.
- Generator `finally` runs on normal completion, mapped exception, and disconnect.
- Slow consumer observes bounded backpressure.
- Cancellation while the worker is between yields stops before the next mutation.
- Cancellation while `next()` is blocked returns/tears down the HTTP response promptly, then worker cleanup occurs after a test gate releases the blocking call. This codifies cooperative, not magical thread cancellation.

#### API factory/host: `tests/api/test_app.py`

- `create_app(include_legacy=False, fake_runtime, temp_dist)` imports without Gradio pages/Kotaemon heavyweight startup.
- `/api/health` is JSON and does not disclose paths/settings.
- `/api/*` wins over SPA catch-all; known React route returns `index.html`; missing asset returns 404.
- `/legacy` exists only when enabled; mounted queue starts once.
- untrusted Host/Origin is rejected for unsafe methods; exact localhost/Vite origins pass.
- config status/save/test never echo a sentinel API key in body, headers, captured logs, or SSE.

#### REST ownership: `tests/api/test_ownership.py`

- Foreign project/node/card/note/resource/conversation/file/group IDs all return the same 404 as nonexistent IDs.
- Mismatched node/project note save is rejected and creates no row.
- User ID in request input is rejected/ignored; all writes use server context.
- File download resolves an authorized stored hash under the storage root; traversal/path input is impossible.
- Concurrent mutation lock returns 409 and releases on success/error/cancel.

#### Chat adapter: `tests/kotaemon_adapter/test_chat.py`

- Import guard: importing adapter does not load `gradio`, `ktem.pages.chat`, `learning_ext.pages`, or construct `FileSelector`/`ChatPage` (subprocess test gives reliable `sys.modules` assertions).
- Headless runtime works before `LearningApp.make()` and without `index.selector`/`_selector_ui`.
- Selected/all/none resolve only authorized IDs; foreign group members are removed/rejected.
- Fake simple pipeline maps token documents to ordered `delta` frames.
- Recording retriever maps duplicate docs to one bounded, plain-text `citation`; hostile metadata/HTML remains data, never rendered server HTML.
- `info` HTML and `plot` are not leaked.
- Empty answer returns a stable `STREAM_FAILED`/empty-answer error.
- Pipeline error/cancel does not persist a partial assistant turn; normal completion persists state/messages/citations once.
- Same-conversation concurrent stream returns 409.
- Contract test against current Kotaemon verifies private attributes/resources used by the retriever factory still exist; failure points implementers to the compatibility module.

#### Library adapter: `tests/kotaemon_adapter/test_library.py`

- Import guard identical to chat.
- List/filter/group queries enforce user on private index.
- File size, suffix, per-user count, safe basename, and temp cleanup on success/error/cancel.
- URL rejects non-http(s), credentials, loopback, private/link-local targets, and unsafe redirect behavior.
- Pipeline `debug/index` documents map to normalized progress/result without paths or exception details.
- Success file ID is retrievable by the chat adapter without a Gradio selector.
- Failed/cancelled indexing removes the newly-created partial SQL/docstore/vectorstore artifact and request temp files.
- Forced reindex cancellation behavior is explicitly tested/documented until staging makes it atomic.
- `quick_index_mode` is false and `done` is not emitted before embedding completes.

#### Real transport: `tests/api/test_sse_transport.py`

Starlette/httpx in-process transports may buffer bodies. Start a real single-worker Uvicorn server on a loopback test port, use `httpx.Client.stream()`, gate the fake generator after its first token, and assert the first `delta` arrives before the gate is released. Close the client after that frame and assert the cancellation signal and eventual worker cleanup. This is the acceptance test for actual chunking and disconnect propagation.

#### Integration and regression

- Index a tiny text fixture, select its returned file ID, run the fake/simple RAG path, and assert a `citation` references that same authorized file.
- Run existing page/service tests to preserve `/legacy` behavior.
- Import `custom_app` only in a subprocess smoke test with Uvicorn patched; normal unit tests should target the factory.
- Launcher test should mock HTTP health responses (connection refused, non-200, malformed JSON, ready) rather than only socket connection.

### Recommended implementation order

1. Extract runtime/config services and add the injectable FastAPI factory with health/security middleware; keep root on legacy until gates pass.
2. Implement and exhaustively test SSE encoding/bridge with fake generators.
3. Add ownership resolvers and learning REST DTOs/routes.
4. Add headless file listing/indexing adapter and compensation tests.
5. Add headless simple-chat adapter, structured citations, conversation repository, and integration test.
6. Mount `/legacy`, add SPA serving, switch launcher readiness/root URL, then enable React as default.

Do not start chat/library adapters before the bridge and ownership tests pass; their current pipelines make cancellation and cross-user mistakes expensive to unwind.

### External references and installed versions

- Installed runtime: FastAPI 0.112.1, Starlette 0.38.6, AnyIO 4.11.0, Gradio 4.39.0, Uvicorn 0.37.0 (environment inspection on 2026-08-18; lockfile confirms FastAPI/Starlette at `kotaemon/uv.lock:1762-1772` and `8080-8088`).
- FastAPI custom responses / `StreamingResponse`: https://fastapi.tiangolo.com/advanced/custom-response/
- Starlette responses: https://www.starlette.io/responses/
- Starlette requests / disconnect detection: https://www.starlette.io/requests/
- AnyIO worker threads and cancellation: https://anyio.readthedocs.io/en/stable/threads.html
- Gradio mounting in FastAPI: https://www.gradio.app/docs/gradio/mount_gradio_app
- SSE wire format: https://html.spec.whatwg.org/multipage/server-sent-events.html

The installed Starlette implementation was inspected: `StreamingResponse.__call__` runs streaming and disconnect listening in an AnyIO task group and cancels the sibling when either completes. The installed `anyio.to_thread.run_sync` exposes `abandon_on_cancel`; this supports prompt response cancellation but cannot terminate the underlying Python thread.

### Related specs

- `.trellis/spec/kotaemon/backend/index.md` — backend pre-development and quality checklist.
- `.trellis/spec/kotaemon/backend/directory-structure.md` — thin route / service / data-access separation.
- `.trellis/spec/kotaemon/backend/database-guidelines.md` — explicit session lifecycle, transactions, and ORM/DTO separation.
- `.trellis/spec/kotaemon/backend/error-handling.md` — boundary validation and safe exception mapping.
- `.trellis/spec/kotaemon/backend/quality-guidelines.md` — type hints, dependency injection, and deterministic tests.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — verify data and state across UI/API/service/storage layers.
- `.trellis/tasks/08-18-learning-cockpit-ui/prd.md` — approved behavior and acceptance criteria, especially R9-R14/R17.
- `.trellis/tasks/08-18-learning-cockpit-ui/design.md` — intended API/package/SSE architecture.
- `.trellis/tasks/08-18-learning-cockpit-ui/implement.md` — execution and verification gates.

## Caveats / Not Found

- Kotaemon exposes a public headless indexing factory but no public headless retriever factory. The adapter must temporarily use `_retriever_pipeline_cls`, `_resources`, `_vs`, `_docstore`, and `_fs_path`. Isolate and contract-test this compatibility seam; do not modify `kotaemon/`.
- Kotaemon `channel="info"` is rendered HTML, not a citation DTO. Structured citations cannot be recovered robustly by parsing that HTML. A recording retriever or an equivalent pre-render interception is required.
- Synchronous LLM/parser/embedding calls cannot be forcibly killed safely from Python. Disconnect is prompt at the HTTP layer and cooperative/eventual in the worker; timeouts and same-thread iterator cleanup are required.
- Kotaemon indexing is not atomic across SQLite, filesystem, docstore, and vectorstore. Compensation can clean a new failed upload, but force-reindex currently removes the old item before the replacement succeeds.
- `quick_index_mode` launches an unjoined embedding thread and is incompatible with truthful completion/cancellation semantics.
- Existing page/service functions frequently fetch by numeric ID without user predicates. API ownership cannot be assumed merely because the UI is currently single-user.
- Existing quick setup silently fails its embedding-manager hot update because of the wrong import name. This must be corrected in the extracted service before claiming RAG readiness.
- The current task design does not list conversation REST endpoints, but the React behavior says “会话.” Omitting them would reduce parity or push durable conversation state into browser storage; the endpoints above are recommended.
- No current tests exercise FastAPI, SSE disconnects, headless Kotaemon adapters, file ownership, or real HTTP chunk arrival. All listed tests are new work.
