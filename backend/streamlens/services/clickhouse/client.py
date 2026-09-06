"""Direct ClickHouse Cloud client.

Used by backend code that needs a deterministic query (health checks, API
endpoints that back a chart). Anything the *agent* decides to run goes
through the MCP toolset in `mcp.py` instead.
"""

from __future__ import annotations

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from streamlens.config import clickhouse_settings


def get_client() -> Client:
    settings = clickhouse_settings()
    return clickhouse_connect.get_client(
        host=settings.host,
        port=int(settings.port),
        username=settings.user,
        password=settings.password,
        secure=settings.secure,
        verify=settings.verify,
        database=settings.database or "default",
    )


def ping() -> str:
    """Return the ClickHouse Cloud server version, or raise."""
    with get_client() as client:
        return client.command("SELECT version()")
