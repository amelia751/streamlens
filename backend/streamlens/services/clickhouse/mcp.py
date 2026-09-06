"""ClickHouse Cloud exposed to the agent as an MCP toolset.

The agent never gets a database handle. It gets MCP tools
(`list_databases`, `list_tables`, `run_query`, ...) served by the official
`mcp-clickhouse` server, pointed at the `streamlens` service in ClickHouse
Cloud.

Two transports, same tools:

* **stdio** (default locally) — the server runs as a `uvx` subprocess.
* **streamable HTTP** — the server runs on Cloud Run behind IAM. Selected
  by setting `STREAMLENS_MCP_URL`. Agent Runtime cannot spawn
  subprocesses, so this is the deployed path.

We run the OSS server rather than the hosted `mcp.clickhouse.cloud`
endpoint because that one authenticates through an interactive OAuth
browser flow, which a headless backend cannot complete.

Both transports are read-only: `CLICKHOUSE_ALLOW_WRITE_ACCESS` is never
set, so the server refuses INSERT, ALTER, and DROP.
"""

from __future__ import annotations

import os

import anyio
import google.auth.transport.requests
import httpx
from google.adk.tools.mcp_tool import (
    McpToolset,
    StdioConnectionParams,
    StreamableHTTPConnectionParams,
)
from google.oauth2 import id_token
from mcp import StdioServerParameters

from streamlens.config import clickhouse_settings

MCP_CLICKHOUSE_VERSION = "0.6.0"


class _CloudRunIdTokenAuth(httpx.Auth):
    """Signs each request with a Google ID token for the Cloud Run service.

    Cloud Run is deployed --no-allow-unauthenticated, so it only accepts
    callers holding roles/run.invoker. `fetch_id_token_credentials`
    resolves the caller from a service-account key file locally and from
    the metadata server once deployed, so the same code works in both.
    """

    def __init__(self, audience: str) -> None:
        self._credentials = id_token.fetch_id_token_credentials(audience)
        self._request = google.auth.transport.requests.Request()

    def _token(self) -> str:
        if not self._credentials.valid:
            self._credentials.refresh(self._request)
        return self._credentials.token

    def sync_auth_flow(self, request):
        request.headers["Authorization"] = f"Bearer {self._token()}"
        yield request

    async def async_auth_flow(self, request):
        # Refreshing is a blocking HTTPS call, so keep it off the loop.
        token = await anyio.to_thread.run_sync(self._token)
        request.headers["Authorization"] = f"Bearer {token}"
        yield request


def _http_toolset(url: str, timeout: float) -> McpToolset:
    audience = url.split("/mcp")[0].rstrip("/")

    def client_factory(headers=None, timeout=None, auth=None) -> httpx.AsyncClient:
        # ADK passes auth=None here; the ID token is ours to attach.
        return httpx.AsyncClient(
            headers=headers,
            timeout=timeout,
            auth=_CloudRunIdTokenAuth(audience),
            follow_redirects=True,
        )

    return McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=url,
            timeout=timeout,
            httpx_client_factory=client_factory,
        ),
    )


def _stdio_toolset(timeout: float) -> McpToolset:
    settings = clickhouse_settings()
    return McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(
                command="uvx",
                args=[
                    "--from",
                    f"mcp-clickhouse=={MCP_CLICKHOUSE_VERSION}",
                    "--python",
                    "3.13",
                    "mcp-clickhouse",
                ],
                env=settings.mcp_env(),
            ),
            timeout=timeout,
        ),
    )


def clickhouse_toolset(timeout: float = 120.0) -> McpToolset:
    """Build the read-only ClickHouse Cloud MCP toolset."""
    url = os.environ.get("STREAMLENS_MCP_URL")
    if url:
        return _http_toolset(url, timeout)
    return _stdio_toolset(timeout)
