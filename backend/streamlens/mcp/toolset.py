"""The in-repo MCP servers, attached to an agent as toolsets.

Same two transports as the ClickHouse toolset, for the same reason:

* **stdio** (default) — the server runs as a subprocess of this interpreter,
  so `adk run` and the tests work with nothing else listening.
* **streamable HTTP** — set `STREAMLENS_DASHBOARD_MCP_URL` or
  `STREAMLENS_PROPOSAL_MCP_URL` to the endpoint the API mounts. That is the
  deployed path, where the agent and the server are the same process and a
  subprocess would just open a second pool against ClickHouse.
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


def _toolset(module: str, url_var: str, timeout: float) -> McpToolset:
    url = os.environ.get(url_var)
    if url:
        return McpToolset(
            connection_params=StreamableHTTPConnectionParams(url=url, timeout=timeout)
        )

    return McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(
                command=sys.executable,
                args=["-m", module],
                # The child needs the same warehouse credentials we were
                # started with; it opens its own connection.
                env=dict(os.environ),
            ),
            timeout=timeout,
        ),
    )


def dashboard_toolset(timeout: float = 120.0) -> McpToolset:
    return _toolset(
        "streamlens.mcp.dashboards", "STREAMLENS_DASHBOARD_MCP_URL", timeout
    )


def proposal_toolset(timeout: float = 180.0) -> McpToolset:
    """The proposal tools.

    A longer default than the dashboard toolset because `generate_still` is
    a real image generation — roughly half a minute — and sharing a
    120-second ceiling with two or three other calls is uncomfortably close.
    """
    return _toolset(
        "streamlens.mcp.proposals", "STREAMLENS_PROPOSAL_MCP_URL", timeout
    )
