"""The dashboard MCP server.

The same tools reach two audiences. Our own agent picks them up over
streamable HTTP from the endpoint this module mounts inside the API, and any
other MCP client — Cursor, Claude Desktop — can run this file over stdio:

    uv run python -m streamlens.mcp.dashboards

FastMCP here is the one bundled with the `mcp` 1.x SDK rather than the
standalone `fastmcp` package, which needs `mcp` 2.x and would collide with
the version the ADK pins.
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from streamlens.dashboards.tools import DASHBOARD_TOOLS

INSTRUCTIONS = """\
Dashboards for a ClickHouse warehouse of streaming and box-office data.

A dashboard is a titled grid of panels. A panel is one SELECT plus a small
spec saying how to draw its columns — you choose the columns and the chart
type, not the pixels.

Adding or changing a panel runs its query first and checks the spec against
the columns that came back. When something does not line up the panel is not
saved and you get the real column list back, so read `problems` and retry
rather than guessing twice.
"""


def build_server() -> FastMCP:
    server = FastMCP("streamlens-dashboards", instructions=INSTRUCTIONS)
    # Serve at the mount root; the caller decides the prefix.
    server.settings.streamable_http_path = "/"
    for tool in DASHBOARD_TOOLS:
        server.add_tool(tool)
    return server


server = build_server()


if __name__ == "__main__":
    server.run(transport="stdio")
