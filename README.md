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
global endpoint) generates the greenlight brief. Cloud Storage holds the raw
lake. The YouTube Data API v3 key is issued and restricted in the same project.
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

---

## Two kinds of agent, on purpose

A chart that hallucinates is worse than no chart, so the model is kept out of
the chart path entirely.

**Deterministic** — [`agents/greenlight`](backend/streamlens/agents/greenlight/agent.py)
runs the same four named queries in the same order for every title, then hands
the results to Gemini to synthesise. No figure in the brief can be invented,
because the model never issues a query. The brief and the dashboard read from
one registry, so they cannot disagree.

**Exploratory** — [`agents/analyst`](backend/streamlens/agents/analyst/agent.py)
gives Gemini the ClickHouse MCP toolset and lets it choose its own SQL. Right
for open-ended questions, wrong for a number someone will act on.

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

# 3. frontend
cd frontend && npm install && npm run dev   # http://localhost:3000
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
