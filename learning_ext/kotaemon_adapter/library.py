from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


class FileCleanupIncomplete(RuntimeError):
    pass


def validate_public_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("URL_NOT_ALLOWED")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except OSError as exc:
        raise ValueError("URL_NOT_ALLOWED") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError("URL_NOT_ALLOWED")
    return url
