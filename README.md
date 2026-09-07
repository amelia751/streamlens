# Streamlens

**What a studio promotes, against what actually performs.**

Netflix publishes its Weekly Top 10. It also runs 44 YouTube channels that push
trailers, clips and Shorts into every major market. Nobody joins the two, so a
question a commissioning editor asks constantly — *did the promotional push
match the result?* — has no answer you can look up.

Streamlens answers it. Public streaming data lands in **ClickHouse Cloud**, a
**Gemini** agent on **Google Cloud** reads it through a fixed retrieval
pipeline, and three dashboards make the mismatches visible.

The finding the product is built around: promotional weight and audience
outcome come apart constantly. *Stranger Things* ran 86 clips across 18
channels and returned 5.8 billion hours. *Bridgerton* ran 2 clips and charted
for 22 weeks. Those are very different businesses, and the difference is
invisible in either dataset alone.

---

## Architecture

```
  Netflix Top 10 (public)  ─┐
  IMDb / MovieLens / TMDB  ─┼─► GCS raw lake ──► ClickPipes ──► ClickHouse Cloud
  VOD clickstream          ─┘                                      (landing.*)
                                                                       │
  YouTube Data API v3 ─────► sync.py ────────────────────────────►  (youtube.*)
     44 Netflix channels     direct insert, never lands in GCS         │
     30-day TTL enforced                                               │
                                                                       ▼
                                              refreshable MV: promo_top10_bridge
                                                                       │
                          ┌────────────────────────────────────────────┤
                          ▼                                            ▼
              FastAPI named-query registry                Gemini 3.8 Flash (Vertex)
              (backend/streamlens/api)                    fixed 4-step pipeline
                          │                                            │
                          └──────────────► Next.js dashboards ◄────────┘
```

**Google Cloud, at runtime:** Vertex AI (`google-genai`, Gemini 3.8 Flash on the
global endpoint) generates the greenlight brief, and Nano Banana Pro
(`gemini-3-pro-image`, same endpoint) generates the still behind a theme
proposal. Cloud Storage holds the raw lake in `gs://streamlens-data`, and the
generated stills in a separate `gs://streamlens-proposals` — separate because
`raw/` is immutable and a model-driven write path must not share an IAM
boundary with it. Neither bucket is public; stills are served only through
[`/api/proposals/{id}/stills/{sid}`](backend/streamlens/api/app.py), so a URL
cannot outlive the proposal that owns it. The YouTube Data API v3 key is issued
and restricted in the same project.
Service-account credentials are loaded in
[`backend/streamlens/config.py`](backend/streamlens/config.py) and the model is
constructed in
[`backend/streamlens/services/gcp/vertex.py`](backend/streamlens/services/gcp/vertex.py).

**ClickHouse Cloud, at runtime:** every chart on every page is a `SELECT`
against ClickHouse. 17 ClickPipes ingest the static sources from GCS; the
YouTube pipeline inserts over the HTTPS interface directly. The agent reaches
the warehouse through the official `mcp-clickhouse` MCP server, read-only.
Client in
[`backend/streamlens/services/clickhouse/client.py`](backend/streamlens/services/clickhouse/client.py),
MCP toolset in
[`backend/streamlens/services/clickhouse/mcp.py`](backend/streamlens/services/clickhouse/mcp.py).

---

## The dashboards

| Dashboard | Question it answers |
|---|---|
| **The Greenlight Room** | Did the promotional push match the Top 10 result? Surfaces heavy-push/weak-chart titles and the inverse. |
| **The Global Rollout** | Which titles travel? The Weekly Top 10 across 94 countries and five years. |
| **The Promo Machine** | How does the 44-channel operation actually publish? Cadence, Shorts mix, market coverage. |
| **Title dossier** | One title across every source, with the Gemini brief on top. |
| **Studio** | The warehouse as a workspace: the live ClickPipe rail, agent-built dashboards on a twelve-column grid, and theme proposals. |

### Two things the agent writes

Both live in the warehouse they describe, in `streamlens.*`, as
ReplacingMergeTree rows versioned by `updated_at`. Neither ever stores rows —
only the query — so what is on screen is live.

| | Dashboard | Theme proposal |
|---|---|---|
| For | An allocator: *what does the data say?* | A filmmaker: *what should I make?* |
| Is | A titled grid of panels | A one-sheet — hook, logline, cast, theme — with charts underneath |
| Tables | `dashboard`, `panel` | `proposal`, `proposal_panel`, `proposal_still` |
| Charts | Its own | **Copies.** `adopt_panel` duplicates a dashboard panel's query and spec, so deleting or editing that dashboard cannot change or break the pitch. What is kept of the source is a label, never a foreign key |
| Images | None | Up to three Nano Banana Pro stills in GCS, keyed server-side; the model passes a prompt and nothing else |

That copy rule is the whole design. A proposal someone has read must not
silently acquire different evidence because a dashboard was edited underneath
it — and it must not collapse into an error because one was deleted. Schema in
[`proposals/schema.sql`](backend/streamlens/proposals/schema.sql).

---

## Two kinds of agent, on purpose

A chart that hallucinates is worse than no chart, so the model is kept out of
the chart path entirely. What differs between the two is how much of the query
the model gets to choose.

**Deterministic** — [`agents/greenlight`](backend/streamlens/agents/greenlight/agent.py)
runs the same four named queries in the same order for every title, then hands
the results to Gemini to synthesise. No figure in the brief can be invented,
because the model never issues a query. The brief and the dashboard read from
one registry, so they cannot disagree.

**Exploratory** — [`agents/analyst`](backend/streamlens/agents/analyst/agent.py)
is the one the Studio chat talks to, and the only agent in the product. Up to
three MCP servers: ClickHouse to read,
[dashboards](backend/streamlens/mcp/dashboards.py) to build, and
[proposals](backend/streamlens/mcp/proposals.py) to pitch. It authors SQL, but
never *serves* it: a panel's query is validated once when it is saved and
replayed from storage thereafter, so no chart on the canvas is drawn from
something the model said this turn.

"Up to three", because the same agent is deployed twice. Beside the API it
holds warehouse credentials and can author. On Agent Runtime it deliberately
holds none — it reaches ClickHouse through an IAM-gated Cloud Run MCP that
holds them itself — so `authoring_enabled()` attaches the warehouse toolset
alone and assembles an instruction that never mentions a tool it does not have.

Every model-influenced query — the MCP's and every stored panel's — runs as
`streamlens_reader`, which holds `SELECT` on `landing` and `youtube` and
nothing else, under `readonly = 2`. Dashboards and proposals are read and
written by `default` through typed helpers the model never supplies SQL for.

The browser never sends SQL. It names a query from
[`api/queries.py`](backend/streamlens/api/queries.py) and passes typed
parameters that ClickHouse binds server-side, so the full set of statements the
product can run is auditable in one file.

---

## Running it

**Prerequisites:** Python 3.11+ with [uv](https://docs.astral.sh/uv/), Node 20+,
a ClickHouse Cloud service, and a Google Cloud project with Vertex AI enabled.

Create `secrets/` (git-ignored) with:

| File | Contents |
|---|---|
| `clickhouse.env` | `CLICKHOUSE_HOST`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` |
| `pctg-sa.json` | Google Cloud service-account key with Vertex AI access |
| `youtube.env` | `YOUTUBE_API_KEY` restricted to `youtube.googleapis.com` |
| `gcs.env` | HMAC credentials for ClickPipes against the raw bucket |

```bash
# 1. schema, then ingest
python3 scripts/youtube/apply_sql.py scripts/youtube/schema.sql
python3 scripts/youtube/apply_sql.py scripts/youtube/analytics.sql
python3 scripts/youtube/sync.py --plan      # quota estimate, makes no API calls
python3 scripts/youtube/sync.py --backfill  # full crawl; --resume reuses cached ids

# 2. backend
cd backend && uv sync
uv run uvicorn streamlens.api:app --port 8000

# 3. web
cd web && npm install && npm run dev   # http://localhost:3000

# optional: three worked proposals, with charts adopted from live dashboards
cd backend && uv run python scripts/seed_proposal.py           # rows only
cd backend && uv run python scripts/seed_proposal.py --stills  # + generated stills
```

`GET /health` confirms the ClickHouse connection. `GET /api/queries` lists every
query the dashboards can run.

---

## Data provenance and compliance

Every number is publicly observed or published. None of it is Netflix internal
data, and the dashboards say so.

**YouTube data never touches the raw lake.** The YouTube API Developer Policies
(III.E.4) require API data to be deleted or refreshed within 30 days, and an
immutable GCS archive cannot honour that. So the YouTube pipeline writes
straight to ClickHouse, and every YouTube-derived table — including the derived
`promo_top10_bridge` — carries `TTL … INTERVAL 30 DAY`. The refresh cadence is
deliberately 21 days, so rows are renewed before the TTL fires.

Statistics fields are `Nullable(UInt64)`, because YouTube returns *absent*
rather than zero when a creator hides likes or disables comments. Recording
those as `0` would silently corrupt every average.

Channel identity is pinned to the immutable `UC…` channel id, never the handle.
Several Netflix-looking handles are squatted or have been reassigned;
`scripts/youtube/channels.json` records the 44 verified channels along with the
impostors that were excluded and why.

Ratios such as hours-per-clip are computed by Streamlens and labelled as such in
the UI. They are not YouTube or Netflix metrics.

---

## Licence

[MIT](LICENSE).
