"""The Streamlens analyst agent.

Gemini on Vertex AI, with ClickHouse Cloud attached over MCP. At this stage
it is a single agent whose only capability is the warehouse; the multi-step
crew is built on top of this.
"""

from __future__ import annotations

from google.adk.agents import Agent

from streamlens.services.clickhouse import clickhouse_toolset
from streamlens.services.gcp import gemini_model

INSTRUCTION = """\
You are the Streamlens analyst. You answer questions about a streaming
media warehouse that lives in ClickHouse Cloud.

You reach the warehouse only through your ClickHouse MCP tools. Never guess
at schemas or row counts — call `list_databases`, `list_tables`, and
`run_select_query` and report what they actually return.

Your access is read-only. Do not attempt INSERT, ALTER, or DROP.

When you describe the data, name the database, the table, and the grain of a
row. Prefer concrete numbers over adjectives.
"""

root_agent = Agent(
    name="streamlens_analyst",
    model=gemini_model(),
    description="Answers questions about the Streamlens warehouse in ClickHouse Cloud.",
    instruction=INSTRUCTION,
    tools=[clickhouse_toolset()],
)
