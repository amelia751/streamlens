"""The proposal MCP server.

The same tools reach two audiences, exactly as `mcp/dashboards.py` does:
our own agent picks them up over streamable HTTP from the endpoint this
module mounts inside the API, and any other MCP client can run this file
over stdio:

    uv run python -m streamlens.mcp.proposals

FastMCP here is the one bundled with the `mcp` 1.x SDK rather than the
standalone `fastmcp` package, which needs `mcp` 2.x and would collide with
the version the ADK pins.
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from streamlens.proposals.tools import PROPOSAL_TOOLS

INSTRUCTIONS = """\
Theme proposals: one-sheets a filmmaker can pitch, over the same ClickHouse
warehouse the dashboards read.

A proposal is prose — a hook, a logline, a cast of archetypes, a theme —
with charts underneath that justify it. It is not a dashboard. Two to four
charts; the prose carries the idea.

Find the evidence first, then write the proposal around it. `adopt_panel`
copies a chart off a dashboard, and the copy is the proposal's own: the
dashboard can later be edited or deleted without touching the pitch. The
query is stored rather than the rows, so the figures under a pitch stay
live.

`read_proposal` replays those queries and returns a `glance` per chart, so
revise from that rather than querying again. `generate_still` takes a
prompt and nothing else — a place, a light, a time of day.

Writes are checked before they land. A field that is too long, a genre
outside the vocabulary, or a chart whose spec does not match its query all
come back as `problems` with nothing saved.
"""


def build_server() -> FastMCP:
    server = FastMCP("streamlens-proposals", instructions=INSTRUCTIONS)
    # Serve at the mount root; the caller decides the prefix.
    server.settings.streamable_http_path = "/"
    for tool in PROPOSAL_TOOLS:
        server.add_tool(tool)
    return server


server = build_server()


if __name__ == "__main__":
    server.run(transport="stdio")
