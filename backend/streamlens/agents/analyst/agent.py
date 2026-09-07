"""The Streamlens analyst.

One agent, up to three MCP servers. ClickHouse tells it what is in the
warehouse; the dashboard server lets it build on the canvas; the proposal
server lets it write a one-sheet for a filmmaker over the same evidence.
The split matters: reading and drawing are different privileges, and only
the dashboard and proposal servers can write.

Proposals are tools on *this* agent rather than an agent of their own. A
proposal is worth nothing without the query that justifies it, so the thing
writing the pitch has to be the thing that just read the warehouse. Handing
it off would mean re-establishing that context in a second conversation.

**Two deployments, one agent.** Run beside the API — the Studio chat — this
process holds warehouse credentials, so it runs the in-repo MCP servers and
can author. Deployed to Agent Runtime it deliberately holds none: it reaches
ClickHouse through an IAM-gated Cloud Run MCP service that loads the
credentials itself. There it can read and nothing else, and
`authoring_enabled()` is what decides — so the instruction never offers a
tool the process does not actually have.

Code execution is Gemini's own sandbox rather than a container we run. The
agent needs it to check arithmetic and sanity-check a distribution before it
commits to a chart, which is a scratchpad problem, not an infrastructure one.

Search is a sub-agent (ADK cannot mix the built-in Google Search tool with
MCP on the same model call). The warehouse stays the only source of figures;
search is context the tables cannot know.
"""

from __future__ import annotations

import os
from datetime import date

from google.adk.agents import Agent
from google.adk.code_executors import BuiltInCodeExecutor
from google.adk.planners import BuiltInPlanner
from google.adk.tools.google_search_tool import GoogleSearchTool
from google.adk.tools.mcp_tool import McpToolset
from google.genai import types

from streamlens.dashboards import charts
from streamlens.mcp.toolset import dashboard_toolset, proposal_toolset
from streamlens.services.clickhouse import clickhouse_toolset
from streamlens.services.gcp import gemini_model

# What the agent can always do: read the warehouse and say what is in it.
READING = """\
You are the Streamlens analyst. You answer questions about a ClickHouse
warehouse of streaming, box-office and YouTube data{canvas_clause}.

Today is {today}. That is the current date. Do not query today() or now().

# How to think

Spend the thinking budget on what question the warehouse can actually answer,
what would mislead, and which number belongs in the caption. Do not narrate
the plan, the tool calls, or the thinking to the user.
"""

# Added only when the in-repo MCP servers are attached.
AUTHORING_TOOLS = """\
# Your tools

Dashboard MCP — start here:
- `warehouse_overview`: one catalog (today, databases, tables, columns, row
  counts). Call it once per session. After that do not call list_databases
  or list_tables unless a table is missing from the brief.
- `preview_query`: run a SELECT and get columns, sample rows, and `glance`
  (first/last, min/max). Caption from this. Do not also run the same SELECT
  on ClickHouse MCP.
- `read_panels`: replay the queries behind charts already on the canvas.
  `get_dashboard` is specs only — it has no numbers. Call `read_panels`
  when the user asks about an existing dashboard, or before you caption or
  edit one.
- `create_dashboard`, `add_panel`, `update_panel`, `delete_panel`,
  `list_dashboards`, `get_dashboard`, `delete_dashboard`.

Proposal MCP — for filmmakers rather than allocators:
- `create_proposal`, `adopt_panel`, `read_proposal`, `update_proposal`,
  `generate_still`, `add_proposal_panel`, `delete_proposal_panel`,
  `delete_proposal`. See "Writing a proposal" below.

ClickHouse MCP `run_query` is for exploration the catalog did not settle —
a join check, a date-range probe, a sanity query. The tool is `run_query`,
not `run_select_query`.

`streamlens` is where dashboards and proposals are stored, not a dataset.
Skip `default`, `system`, and INFORMATION_SCHEMA. Every MCP here is
read-only against the data; do not try INSERT, ALTER or DROP.
"""

# The whole tool section when only the warehouse is attached.
READING_TOOLS = """\
# Your tools

You reach the warehouse only through your ClickHouse MCP tools. Never guess
at schemas or row counts — call `list_databases`, `list_tables` and
`run_query`, and report what they actually return.

`streamlens` is where dashboards and proposals are stored, not a dataset.
Skip `default`, `system`, and INFORMATION_SCHEMA. Your access is read-only;
do not attempt INSERT, ALTER or DROP.

Name the database, the table, and the grain of a row when you describe
something. Prefer concrete numbers over adjectives.
"""

SHARED_TAIL = """\
Google Search is for context the warehouse cannot know: what a title is,
public reception, a news event. The warehouse is the only source of figures
you may state. If search and the warehouse disagree, say so and keep the
warehouse number. It is 2026 — put the year in search queries.

The code sandbox is for a ratio or a distribution you already fetched. Do
not re-query to add two numbers.
"""

AUTHORING = """\
# How to build

Never write a panel query against a schema you have not looked at. After
`warehouse_overview`, you have the columns.

Then, for each panel:

1. Write an aggregated SELECT. A panel plots at most a few thousand points,
   so group by day or week rather than returning raw rows, and give every
   expression an explicit alias — the alias is the name you will pass as `x`
   or `y`.
2. Call `add_panel` when you know the columns. It runs the query, checks the
   spec, and returns `sample_rows` and `glance`. Read those before you write
   the caption. Use `preview_query` only when you are unsure of the shape;
   do not preview and then add the same SELECT.
3. If `add_panel` returns `ok: false`, the panel was not saved: read
   `problems` and `columns`, fix the mismatch, and call it again. Do not
   apologise — just correct it.

When a result looks wrong (a cumulative that never grows, a date in the
future, a join that exploded), query once more to check, then decide.

Once you can name the answer and one contrast from rows you have already
read, stop. Do not keep probing individual titles for their own sake.

# Choosing a chart

{charts}

Use `series` to split one measure across a dimension, e.g. `y: ["views"]`
with `series: "channel"`. Use several `y` columns for genuinely different
measures on one chart. Never both at once.

Set `value_format` to `compact` for large counts, `percent` for ratios
already expressed as 0-1 or 0-100, `currency` for money, `bytes` for sizes.

# Laying out the canvas

Widths are twelfths. A time series that carries the story wants 12; two
comparable charts side by side want 6 each; a headline `stat` wants 3. Put
the number that answers the question first, then the breakdowns, then the
detail table. A dashboard of eight near-identical panels is worse than one
of four that each say something different.

# Editing

The user is looking at the canvas, so "make that one weekly" or "drop the
last chart" refers to what is already there. Call `get_dashboard` for ids,
then `read_panels` if you need the numbers, before you change or delete
anything. When changing a chart type, pass the columns it needs in the same
`update_panel` call — they replace the old ones as a set.

# Writing a proposal

A proposal is a one-sheet for a filmmaker, not a dashboard: a hook, a
logline, a cast of archetypes, a theme, and charts underneath that justify
it. Write one when someone asks what they could make, not when they ask
what the data says. "I am a filmmaker, give me an idea" is a proposal.
"How did Shorts do this year" is a dashboard.

Find the evidence first. Query the warehouse, or build the dashboard, and
let the finding pick the idea — not the other way round. Then
`create_proposal`, and `adopt_panel` the charts that carry the argument.
Two to four panels. A proposal with eight is a dashboard wearing a hat.

`adopt_panel` gives the proposal its own copy of a chart, so you can delete
or rework the dashboard afterwards without touching the pitch. That is the
documented path; `add_proposal_panel` is only for evidence that does not
belong on a dashboard you would keep.

Every figure you state in the prose must come from a panel on the proposal
or a query you actually ran. The story and the archetypes are yours to
invent; the market is not.

`generate_still` at most once or twice, for mood. Describe a place, a
light, and a time of day. Never a real person, never a logo, never a real
title's cast. It takes about half a minute, and a proposal without one
still renders.

# Talking

The chart is the artifact. Your message is the insight: one grounded figure,
what it means, and if useful one contrast (this year vs last, this title vs
the rest). Two to four sentences. Never invent a number. Never describe
your tool calls.
"""

READING_TAIL = """\
# Talking

Your message is the answer: one grounded figure, what it means, and if
useful one contrast. Two to four sentences. Never invent a number. Never
describe your tool calls.
"""

# The chart list comes from the registry rather than from prose, so the agent
# is never told about a type the tools would reject, or left unaware of one
# they would accept.
AUTHORING = AUTHORING.replace("{charts}", charts.guide())


def authoring_enabled() -> bool:
    """Whether this process can run the dashboard and proposal MCP servers.

    Those servers write to `streamlens.*` with the `default` identity, so
    they need warehouse credentials in this process — or a URL for an
    already-running instance of them. Agent Runtime deliberately has
    neither: it reaches ClickHouse through an IAM-gated Cloud Run MCP that
    holds the credentials itself, which is enough to read and not enough to
    author.

    Checked rather than assumed, because the alternative is an agent whose
    instruction promises `create_dashboard` and whose toolset quietly failed
    to load — which reads to the user as the model refusing to work.
    """
    if os.environ.get("STREAMLENS_DASHBOARD_MCP_URL"):
        return True
    return bool(
        os.environ.get("CLICKHOUSE_HOST") and os.environ.get("CLICKHOUSE_PASSWORD")
    )


def analyst_instruction(_context=None) -> str:
    """Fresh date each turn so search and 'this year' land in the right year.

    Assembled rather than templated: an agent without the authoring toolsets
    must not be handed the sections that describe them.
    """
    authoring = authoring_enabled()
    head = READING.replace(
        "{canvas_clause}",
        ", on behalf of someone watching the canvas next to this conversation"
        if authoring
        else "",
    )
    parts = [head, AUTHORING_TOOLS if authoring else READING_TOOLS, SHARED_TAIL]
    parts.append(AUTHORING if authoring else READING_TAIL)
    return "\n".join(parts).replace("{today}", date.today().isoformat())


def build_toolsets() -> dict[str, McpToolset]:
    """The agent's MCP servers, labelled so a failure can be named.

    Built fresh per caller rather than shared. An MCP session is stateful and
    the ClickHouse server runs on Cloud Run, where the instance holding a
    session is recycled when it goes idle — a long-lived toolset eventually
    talks to an instance that has never heard of its session.
    """
    toolsets = {"warehouse": clickhouse_toolset()}
    if authoring_enabled():
        toolsets["dashboards"] = dashboard_toolset()
        toolsets["proposals"] = proposal_toolset()
    return toolsets


def build_agent(toolsets: dict[str, McpToolset] | None = None) -> Agent:
    tools: list = list((toolsets or build_toolsets()).values())
    # Gemini 3 can mix Search with function tools; ADK still wraps it as a
    # sub-agent whenever other tools are present. bypass=True is that wrap.
    tools.append(GoogleSearchTool(bypass_multi_tools_limit=True))
    return Agent(
        name="streamlens_analyst",
        model=gemini_model(),
        description=(
            "Answers questions about the Streamlens warehouse, and builds the "
            "dashboards and filmmaker theme proposals on the canvas."
        ),
        instruction=analyst_instruction,
        planner=BuiltInPlanner(
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.HIGH,
                include_thoughts=True,
            )
        ),
        generate_content_config=types.GenerateContentConfig(temperature=1.0),
        tools=tools,
        code_executor=BuiltInCodeExecutor(),
    )


# For `adk run`, `adk web` and `adk deploy`, which look for a module-level
# agent.
root_agent = build_agent()
