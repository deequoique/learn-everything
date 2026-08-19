from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from learning_ext.api.dependencies import default_session_factory
from learning_ext.api.errors import ApiError
from learning_ext.api.routes import router
from learning_ext.api.security import LocalOriginMiddleware


def create_app(
    *,
    runtime: Any = None,
    session_factory: Callable | None = None,
    web_dist: Path | None = None,
) -> FastAPI:
    app = FastAPI(title="LearnEverything API", version="1", docs_url=None, redoc_url=None)
    app.state.runtime = runtime
    app.state.session_factory = session_factory or default_session_factory
    dist = (web_dist or Path(__file__).resolve().parents[1] / "web" / "dist").resolve()
    app.state.frontend_available = (dist / "index.html").is_file()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Accept", "Content-Type"],
    )
    app.add_middleware(
        LocalOriginMiddleware,
        allowed_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    )
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["127.0.0.1", "localhost", "testserver"],
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, exc: ApiError):
        return JSONResponse(exc.detail, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, _exc: RequestValidationError):
        return JSONResponse(
            {"code": "VALIDATION_FAILED", "message": "请求内容不符合要求"},
            status_code=422,
        )

    app.include_router(router)

    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="web-assets")

    @app.get("/{spa_path:path}", include_in_schema=False)
    async def spa(spa_path: str):
        if spa_path == "legacy" or spa_path.startswith(("api/", "legacy/", "assets/")):
            return JSONResponse({"code": "NOT_FOUND", "message": "没有找到该资源"}, status_code=404)
        if not (dist / "index.html").is_file():
            return JSONResponse(
                {"code": "FRONTEND_NOT_BUILT", "message": "前端尚未构建，请先运行 build_web 脚本"},
                status_code=503,
            )
        candidate = (dist / spa_path).resolve()
        if spa_path and candidate.is_relative_to(dist) and candidate.is_file():
            return FileResponse(candidate)
        if Path(spa_path).suffix:
            return JSONResponse({"code": "NOT_FOUND", "message": "没有找到该文件"}, status_code=404)
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-store"})

    return app
