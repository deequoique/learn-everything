from __future__ import annotations

from typing import Any

from fastapi import HTTPException


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(status_code=status_code, detail={"code": code, "message": message})


def not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", "没有找到该资源")


def bad_request(message: str, code: str = "VALIDATION_FAILED") -> ApiError:
    return ApiError(400, code, message)


def sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if key.lower() in {"api_key", "authorization", "token"} else sanitize(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [sanitize(item) for item in value]
    if isinstance(value, str) and ("bearer " in value.lower() or "sk-" in value.lower()):
        return "[REDACTED]"
    return value
