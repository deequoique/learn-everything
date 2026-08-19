from __future__ import annotations

from collections.abc import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


class LocalOriginMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, allowed_origins: Iterable[str] = ()) -> None:
        super().__init__(app)
        self.allowed_origins = set(allowed_origins)

    async def dispatch(self, request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            if origin:
                own = f"{request.url.scheme}://{request.headers.get('host', '')}"
                if origin != own and origin not in self.allowed_origins:
                    return JSONResponse(
                        {"detail": {"code": "ORIGIN_NOT_ALLOWED", "message": "拒绝跨站写入请求"}},
                        status_code=403,
                    )
        return await call_next(request)
