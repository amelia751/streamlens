"""The dashboard MCP server, attached to an agent as a toolset.

Same two transports as the ClickHouse toolset, for the same reason:

* **stdio** (default) — the server runs as a subprocess of this interpreter,
  so `adk run` and the tests work with nothing else listening.
* **streamable HTTP** — set `STREAMLENS_DASHBOARD_MCP_URL` to the endpoint
  the API mounts. That is the deployed path, where the agent and the server
  are the same process and a subprocess would just open a second pool
  against ClickHouse.
"""

from __future__ import annotations

import os
import sys

from google.adk.tools.mcp_tool import (
    McpToolset,
    StdioConnectionParams,
    StreamableHTTPConnectionParams,
)
from mcp import StdioServerParameters


def dashboard_toolset(timeout: float = 120.0) -> McpToolset:
    url = os.environ.get("STREAMLENS_DASHBOARD_MCP_URL")
    if url:
        return McpToolset(
            connection_params=StreamableHTTPConnectionParams(url=url, timeout=timeout)
        )

    return McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(
                command=sys.executable,
                args=["-m", "streamlens.mcp.dashboards"],
                # The child needs the same warehouse credentials we were
                # started with; it opens its own connection.
                env=dict(os.environ),
            ),
            timeout=timeout,
        ),
    )
