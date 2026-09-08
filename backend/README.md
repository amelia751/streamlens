# Streamlens backend

Gemini on the Gemini Enterprise Agent Platform, driving ClickHouse Cloud
over MCP.

## Architecture

```
Agent Runtime (us-central1)          Cloud Run (us-central1)        ClickHouse Cloud
┌───────────────────────┐  ID token  ┌──────────────────────┐       ┌──────────────┐
│ streamlens_analyst    │ ─────────► │ mcp-clickhouse       │ ────► │  streamlens  │
│ gemini-3.8-flash      │  IAM-gated │ streamable HTTP      │ HTTPS │  ~270M rows  │
│ (global endpoint)     │ ◄───────── │ read-only            │ ◄──── │              │
└───────────────────────┘   MCP      └──────────────────────┘       └──────────────┘
                                       creds from Secret Manager
```

The two halves are separate services because ADK requires `mcp<2` while
`mcp-clickhouse` pulls `mcp` 2.x through FastMCP 4. They cannot share an
interpreter, and Agent Runtime cannot spawn a stdio subprocess, so the MCP
server runs as its own IAM-gated Cloud Run service.

## Layout

```
backend/
├── streamlens/
│   ├── config.py              settings; reads ../secrets/*.env, env wins
│   ├── services/              one directory per platform, one registry each
│   │   ├── clickhouse/        clickhouse_services.py — EVERY ClickHouse call
│   │   │                      (+ catalog.py / sources.py, reads built on it)
│   │   └── gcp/               gcp_services.py — EVERY Google Cloud call
│   ├── dashboards/            panel spec, chart registry, store, tool surface
│   ├── proposals/             one-sheet doc, store, stills, tool surface
│   ├── mcp/                   the two in-repo MCP servers + their toolsets
│   ├── api/                   FastAPI app; also mounts /mcp/dashboards, /mcp/proposals
│   └── agents/                ADK agents_dir
│       ├── analyst/           agent.py exports root_agent — the one agent
│       └── greenlight/        fixed-pipeline brief, no model-authored SQL
├── deploy/
│   ├── clickhouse-mcp/        Dockerfile for the MCP Cloud Run service
│   ├── agent-runtime.vars     non-secret env for the deployed agent
│   └── deploy.sh              secrets | mcp | agent
└── scripts/
    ├── ask_agent.py           run the analyst locally, one turn per argument
    ├── ask_remote_agent.py    call the deployed analyst
    ├── seed_gallery.py        one dashboard holding every chart type
    └── seed_proposal.py       three worked proposals, --stills to generate art
```

`services/` holds only platform access; agent behaviour lives in `agents/`,
so neither becomes a junk drawer. Within `services/`, each platform has
exactly **one** registry module that constructs every client and makes every
call into that platform. Nothing else in the codebase opens a ClickHouse
connection or builds a Google client — so those two files are a complete
answer to "what does this use, and where".

Both are executable, and calling them is a live integration test:

```bash
uv run python -m streamlens.services.gcp.gcp_services
uv run python -m streamlens.services.clickhouse.clickhouse_services
```

Each walks its `SERVICES` registry, calls the service for real, and prints
what came back — a Gemini completion, a generated PNG's byte count, a GCS
round-trip, a minted Cloud Run ID token, the ClickPipes state, and a write
that the reader identity is refused.

## Setup

```bash
cd backend
uv sync --python 3.13
```

`uvx` must be on PATH for local runs — the ClickHouse MCP server runs as
its own process. Credentials come from `../secrets/` (gitignored):
`clickhouse.env` for the warehouse, `pctg-sa.json` for Google Cloud.

## Run

```bash
# Local: MCP server as a uvx stdio subprocess
uv run python scripts/ask_agent.py "What data do you have access to?"

# Measure the tool use rather than eyeball it: every call and result,
# untruncated, as JSONL alongside the readable terminal output.
STREAMLENS_TRACE=run.jsonl uv run python scripts/ask_agent.py "build me a dashboard"

# Local agent against the deployed MCP server
STREAMLENS_MCP_URL=https://streamlens-clickhouse-mcp-148137280149.us-central1.run.app/mcp \
  uv run python scripts/ask_agent.py "What data do you have access to?"

# Fully deployed
uv run python scripts/ask_remote_agent.py "What data do you have access to?"

# Dev UI with tool-call traces
uv run adk web streamlens/agents
```

## Deploy

```bash
./deploy/deploy.sh secrets   # ClickHouse creds -> Secret Manager
./deploy/deploy.sh mcp       # MCP server -> Cloud Run
./deploy/deploy.sh agent     # analyst agent -> Agent Runtime
```

## One agent, two shapes

There is a single agent — [`agents/analyst`](streamlens/agents/analyst/agent.py)
— and what it can do depends on what the process it is running in holds.

| | Beside the API (Studio chat) | Agent Runtime |
|---|---|---|
| Warehouse credentials | yes, from `../secrets/` | **no**, by design |
| MCP servers | ClickHouse + dashboards + proposals | ClickHouse only |
| Can | read, build dashboards, write proposals | read |

`authoring_enabled()` is the switch. The dashboard and proposal servers
write to `streamlens.*` as `default`, so they need warehouse credentials in
*this* process; Agent Runtime deliberately has none and reaches ClickHouse
through the IAM-gated Cloud Run MCP, which holds them itself. The
instruction is assembled from the same check, so the deployed agent is
never told about a tool it does not have — which is the failure mode this
replaces, where a toolset quietly fails to load and the model reads as
though it were refusing to work.

## Where a conversation lives

Turns are stateless — the MCP connections open and close with each one — but
conversations are not, so they are kept outside the process by ADK's session
and memory services ([`agents/analyst/sessions.py`](streamlens/agents/analyst/sessions.py)).
A **session** is one thread, replayed to the model every turn, which is what
makes "add that to the dashboard" land. **Memory** is every other thread,
searched rather than replayed, which is what lets a new conversation pick up
"the Shorts dashboard from yesterday" without paying for yesterday's tokens.

| `STREAMLENS_SESSION_BACKEND` | service | where threads live |
|---|---|---|
| `db` (default) | `DatabaseSessionService` | `STREAMLENS_SESSION_DB_URL`, or a SQLite file in `.data/` |
| `vertex` | `VertexAiSessionService` | the Agent Runtime the analyst deploys to |
| `memory` | `InMemorySessionService` | nowhere; tests only |

Production is Cloud SQL for Postgres:

```bash
STREAMLENS_SESSION_DB_URL=postgresql+asyncpg://user:pw@host/streamlens
```

Postgres rather than SQLite because `DatabaseSessionService` serialises
writes to a single session with `SELECT ... FOR UPDATE` there, which is what
makes two API replicas safe on one conversation. Either way the driver must
be async: `sqlite+aiosqlite`, not `sqlite`.

Memory is Memory Bank on the same Agent Runtime by default
(`STREAMLENS_MEMORY_BACKEND=vertex`; `memory` for a keyword store in
process, `off` for no cross-thread recall). `PreloadMemoryTool` searches it
with the user's own words each turn, so recall costs no round trip. Long
threads are kept affordable by `EventsCompactionConfig`, which summarises
older turns in place instead of dropping them. `/health` reports which
backends a running process actually got.

## Linking to what it built

"Added the IMDb panel" is not much use if finding the panel is the reader's
problem. So every tool that writes returns a `link` alongside the id
([`links.py`](streamlens/links.py)) — `/studio?dashboard=…&panel=…` for a
chart, `/studio?proposal=…` for a one-sheet — and the instruction has the
model name what it made as a markdown link using that value verbatim.

The link travels with the result rather than being assembled in the reply
because the ids are generated: a path the model wrote from memory is a dead
end the user only discovers by clicking it. The rule in the instruction is
the same one the tool docstrings state, and it is the whole mechanism — no
extra channel, and nothing the SSE stream has to carry.

They are real paths, not a private scheme. The chat intercepts a plain click
and opens the tab, because the canvas is beside the conversation and
reloading to reach it would be absurd; a modifier-click goes to the browser,
and the workspace reads the same query string on arrival, so the link also
works pasted, bookmarked, or opened in a second window.

## Pointing at a chart

The links go the other way too. Every panel has a copy button that puts one on
the clipboard, and pasting it into the chat attaches that chart to the turn —
the same gesture as pasting code into a coding agent, and it has to mean the
same thing: the chart arrives as content, not as an address the model is
invited to go and look up.

So the browser strips the path out of what was pasted, shows a chip standing
for the chart, and sends the path back in `attachments`.
[`attachments.py`](streamlens/api/attachments.py) resolves each one through
the same stores the tools use and prepends a block to the user's turn: title,
the ids that address it, the spec, the SQL, and the rows it is drawing right
now. Resolved server-side because the two costs are not comparable — a panel
query is a warehouse round trip, while a tool call the model has to decide to
make is a model round trip and one it can skip. "Based on this chart, what
would you make" is then answerable on the first call, and it is: measured at
one model call, no tools.

The block is what `"this chart"` means for that turn, ahead of the open tab,
and it carries the ids so an edit lands on that panel rather than one the
model went looking for. It is content, so it stays in the session and a
follow-up still knows what "it" was; a replayed transcript drops it by its
`[attached]` marker, because nobody typed a page of sample rows.

## How the two platforms are used

**Google Cloud** — `gemini-3.8-flash` on the Agent Platform API
(`aiplatform.googleapis.com`, formerly Vertex AI), project `pctg-503822`.
The agent itself is deployed to Agent Runtime as reasoning engine
`3345740765799120896`. Supporting services: Cloud Run, Secret Manager,
Artifact Registry, Cloud Build, Cloud Logging.

The model is built as an explicit `Gemini` object with `client_kwargs`
pinning `location="global"`, because `gemini-3.8-flash` is served only from
the global endpoint — the `us-central1` endpoint returns 404 for it, and
Agent Runtime exports its own region into the environment.

**ClickHouse Cloud** — service `streamlens`, ~270M rows across the
`landing` and `youtube` databases, plus the `streamlens` database holding
dashboard and proposal definitions. The agent explores through the official
`mcp-clickhouse` server (`list_databases`, `list_tables`, `run_query`, ...).
`services/clickhouse/mcp.py` picks the transport: streamable HTTP when
`STREAMLENS_MCP_URL` is set, otherwise a `uvx` stdio subprocess. The two
in-repo servers in `mcp/` take the same either/or on
`STREAMLENS_DASHBOARD_MCP_URL` and `STREAMLENS_PROPOSAL_MCP_URL`.

`services/clickhouse/client.py` is a separate direct `clickhouse-connect`
client for queries the backend runs itself, so deterministic reads never
go through the model.

## Security

The MCP service is deployed `--no-allow-unauthenticated`; anonymous
requests get 403. Callers must present a Google-signed ID token from a
principal holding `roles/run.invoker`, which the agent attaches through a
custom `httpx.Auth` that resolves credentials from a key file locally and
from the metadata server once deployed.

ClickHouse credentials live in Secret Manager and are mounted only into
the MCP service, which runs as its own least-privilege service account
(`streamlens-mcp`) holding `secretAccessor` on exactly three secrets. The
agent never sees them.

`CLICKHOUSE_ALLOW_WRITE_ACCESS` is never set, so the MCP server rejects
`INSERT`, `ALTER`, and `DROP` on both transports.

Every query the model influences — the ClickHouse MCP's, and every stored
panel query a dashboard or proposal replays — runs as `streamlens_reader`
under `readonly = 2`, with a 30-second ceiling and a 5,000-row cap. That
identity holds `SELECT` on `landing` and `youtube` and nothing else, not
even on `streamlens`: definitions are read and written by `default` through
typed helpers the model never supplies SQL for. `scripts/clickhouse/create_reader.py`
is the source of truth for those grants.

Generated proposal stills go to `gs://streamlens-proposals`, a bucket
separate from the raw lake with uniform access and public access prevention
enforced. The model passes a prompt; the object key is derived server-side
and no signed URL is ever minted, so the bytes are reachable only through
`/api/proposals/{id}/stills/{sid}`.

### Why not the hosted MCP endpoint

ClickHouse Cloud offers `https://mcp.clickhouse.cloud/mcp`, but it
authenticates with an interactive OAuth browser flow that a headless
backend cannot complete. The OSS server authenticates from environment
variables, so it works the same locally and on Cloud Run.

## Known rough edges

**Sessions are in-memory.** Agent Runtime executes as a Google-managed
service agent whose credentials carry no quota project, so Vertex bills
its calls to an empty default bucket and returns 429 — including from
ADK's managed session service, which is constructed before any of our code
runs and so cannot be fixed by setting `GOOGLE_CLOUD_QUOTA_PROJECT` in
process. Agent Runtime also rejects that variable in the deployment spec
as reserved. The deploy therefore passes `--session_service_uri memory://`.
Conversation history does not survive an instance restart.

**The agent runs as the default service agent.** A dedicated
`streamlens-agent` service account exists and holds `aiplatform.user` plus
`run.invoker` on the MCP service, but `adk deploy agent_engine` has no
`--service_account` flag and ignores `service_account` in
`.agent_engine_config.json`, so it is not attached yet.
