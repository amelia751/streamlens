"""Direct ClickHouse Cloud client.

Used by backend code that needs a deterministic query (health checks, API
endpoints that back a chart). Anything the *agent* decides to run goes
through the MCP toolset in `mcp.py` instead.
"""

from __future__ import annotations

import threading

import clickhouse_connect
from clickhouse_connect.driver.client import Client

from streamlens.config import clickhouse_settings

_local = threading.local()


def shared_client() -> Client:
    """A client bound to the calling thread.

    A clickhouse-connect client carries a server-side session, and a session
    rejects concurrent queries outright. The dashboards fetch four or five
    tiles at once, so a single process-wide client fails as soon as two of
    those land together, while a client per request throws away the
    connection and the server metadata handshake every time. One per thread
    sits between the two: FastAPI runs sync endpoints on a bounded threadpool,
    so this settles into a small, reused pool.
    """
    client = getattr(_local, "client", None)
    if client is None:
        client = get_client()
        _local.client = client
    return client


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
