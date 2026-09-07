# Proposals — bringing the feature to life

Step-by-step plan to turn the mocked Proposals tab into a real feature: one
agent, warehouse-owned proposals, GCS-held stills, and charts that survive the
dashboard they came from.

---

## 0. Answers first

### Where do reports live — GCS or Cloud SQL?

**Neither, for the content. Content goes in ClickHouse; only the images go in
GCS. Cloud SQL is the wrong tool here.**

| Part of a proposal | Home | Why |
|---|---|---|
| Prose, genre, budget, archetypes, panel definitions | ClickHouse `streamlens.proposal*` | Same store, same idiom, same connection as `streamlens.dashboard` / `streamlens.panel`, which a proposal cites |
| Generated stills (PNG, ~1.7 MB each) | `gs://streamlens-proposals` | Object storage is for objects |
| Rendered numbers | Nowhere | Replayed live from the stored query, same as a panel |

**Why not Cloud SQL.** `sqladmin.googleapis.com` is not even enabled on
`pctg-503822`, and turning it on buys a new stateful service, a connector or
public IP, a second credential path, a migration tool, and roughly $45–70/month
of idle instance — to hold a few dozen rows. Meanwhile
`backend/streamlens/dashboards/schema.sql` already argues the opposite case and
the argument transfers verbatim: the definition lives in the warehouse it
describes, so it cannot drift from the data. A proposal's panels *are*
dashboard panels; putting proposals in Postgres turns every read into a
cross-store join done in Python.

The write pattern also matches what `dashboard`/`panel` already do — append a
newer versioned row, tombstone with `is_deleted = 1`, read with `FINAL`, at
trivial row counts. That is exactly the shape ReplacingMergeTree is good at.

**Why the images are not in ClickHouse.** Measured on this project: Nano Banana
Pro (`gemini-3-pro-image`, global endpoint) returns a 1.7 MB PNG;
`gemini-2.5-flash-image` returns 1.3 MB. A column that size drags every merge
and every `SELECT *`, and FastAPI would have to base64 it back out.

**Why a new bucket and not `gs://streamlens-data`.** `raw/` in that bucket is
the sacred lake ClickPipes reads from. A model-driven write path must not share
an IAM boundary with it. New bucket:

```bash
gcloud storage buckets create gs://streamlens-proposals \
  --location=us-central1 \
  --uniform-bucket-level-access \
  --public-access-prevention
```

Objects are never public and never signed for the model. They are served
through the backend at `/api/proposals/{id}/stills/{still_id}`, which is one
fewer moving part than signed URLs and means a URL cannot outlive a deleted
proposal. Signed V4 URLs are the upgrade path if bandwidth ever matters.

### If we delete the dashboard, do the charts go with it?

**Today: yes, and that is the bug.** `web/src/components/proposal.tsx` renders
`MarketPanels({ dashboardId })`, which fetches `/api/dashboards/{id}` live.
Tombstone the dashboard and `store.get_dashboard` raises, the route 404s, and
the entire marketplace section of the report collapses into an error string.

**Fix: the proposal owns copies of the panel definitions, not a pointer to
someone else's.** `streamlens.proposal_panel` holds the same columns as
`streamlens.panel` — `title`, `query`, `spec`, `position`, `width`, `height` —
plus provenance columns that are *labels only*. The proposal replays its own
copy of the SELECT through the same read-only gate a dashboard panel uses.

Three properties fall out of that, and all three are wanted:

- **The query is stored, never the rows.** Numbers stay live, so a pitch never
  quotes a six-month-old figure. This is the principle already stated in
  `dashboards/schema.sql`; the proposal just extends it.
- **The definition is owned, not borrowed.** Deleting, editing, or renaming the
  source dashboard cannot touch the proposal.
- **Provenance survives as prose.** The report can still say "adapted from
  YouTube Overview" and link to it, and the link degrades to plain text when
  the dashboard is gone. Never an error.

One trap worth naming: `store.create_dashboard` only checks *live* rows for a
slug collision, so a tombstoned `youtube-overview` can be re-used by a later,
unrelated dashboard. So `source_dashboard_title` is written at authoring time
rather than resolved from the id at read time.

### Problem space

Streamlens today answers a commissioning editor's question: *did the
promotional push match the result?* Proposals answer a different person's
question — a filmmaker's: **what should I make, and what is the evidence
anyone will watch it?**

The proposal is the artifact that carries both halves: prose a human can pitch
out loud, and charts underneath it that came from the warehouse rather than
from the model. So "I'm a filmmaker, give me some ideas" becomes a real turn in
the existing chat, and what lands on the canvas is a one-sheet instead of a
dashboard.

### One agent

The chat is served by **`backend/streamlens/agents/curator/agent.py`** — that
is the agent the UI labels "Analyst". Proposal tools go **on that agent**. No
proposals agent, no sub-agent, no crew.

Naming caveat to keep straight while working: `agents/analyst/` is a
*different*, thinner agent (ClickHouse MCP only) that `deploy.sh agent`, ships
to Agent Runtime and `scripts/ask_agent.py` drives. It is not the chat agent.
Renaming `curator` → `analyst` would be a sensible cleanup but it is not part
of this feature — don't mix it in.

---

## 1. What exists today

Verified live, not assumed.

**ClickHouse Cloud** (`streamlens`, `cqobxgg69k.us-central1.gcp.clickhouse.cloud`)
- `landing.*` — 17 ClickPipe tables, IMDb / MovieLens / Netflix Top 10 / VOD clickstream
- `youtube.*` — `channel`, `video`, `video_stats`, `promo_top10_bridge`, all under a 30-day TTL
- `streamlens.dashboard` (12 rows) / `streamlens.panel` (109 rows)
- `streamlens_reader` holds `SELECT` on `landing.*`, `youtube.*`, `streamlens.*`, and seven `system` tables. Nothing else.
- Three live dashboards, and they are exactly the three the mock cites:
  `youtube-overview`, `shorts-vs-longform`,
  `youtube-channel-activity-network-growth`

**Google Cloud** (`pctg-503822`)
- Buckets: `streamlens-data` (raw lake, public access prevention enforced),
  `streamlens-agent-staging` (empty, us-central1), `run-sources-…`
- Cloud Run: `streamlens-clickhouse-mcp`
- No Cloud SQL, and `sqladmin.googleapis.com` disabled
- `google-cloud-storage` is already a backend dependency — no new package
- Image generation confirmed working on the global endpoint:
  `gemini-3-pro-image` → `finish_reason=STOP`, one `image/png` part, 1.7 MB

**MCP**
- In-repo: `streamlens/mcp/dashboards.py` (12 dashboard tools, stdio or
  streamable HTTP, mounted at `/mcp/dashboards`) and
  `services/clickhouse/mcp.py` (official `mcp-clickhouse`, read-only)
- In Cursor: only `cursor-ide-browser` is wired up. Useful for verifying the
  report renders; it is not part of the feature.

**The mock, and how deep it goes**
- `web/src/mock/proposals.ts` — three hand-written proposals
- `web/src/app/api/mock/proposals/{route.ts,[id]/route.ts}`
- `web/public/mock/*.png` — three ~2 MB stills, already Nano-Banana-shaped
- `web/src/lib/proposals.ts` — types + fetchers, already pointed at the mock prefix
- `web/src/components/proposal.tsx` — the report; the only broken part is `MarketPanels`
- `web/src/components/sidebar.tsx` — the Proposals rail pane
- `web/src/components/workspace.tsx` + `canvas.tsx` — `kind: "proposal"` tabs already exist
- `web/src/app/globals.css` — every `report-*` class the real thing needs is already written

That last point matters for scoping: **the UI is basically done.** This is a
store, an agent surface, and an image pipeline, not a redesign.

---

## 2. Schema

New file: `backend/streamlens/proposals/schema.sql`. Same conventions as
`dashboards/schema.sql` — ReplacingMergeTree keyed on identity, versioned by
`updated_at`, deletes are appends with `is_deleted = 1`, reads use `FINAL`.

```sql
CREATE TABLE IF NOT EXISTS streamlens.proposal
(
    id          String,
    title       String,
    genre       String,
    kicker      String,
    budget      String,
    hook        String,
    logline     String,
    connection  String,
    story       String,
    market      String,

    -- [{name, note}] as JSON. A fixed-shape list of two short strings does
    -- not earn a table of its own.
    archetypes  String,

    -- Provenance, not a foreign key. Nothing here is dereferenced to render
    -- the report; the title is stored because dashboard ids can be recycled.
    source_dashboard_id    String DEFAULT '',
    source_dashboard_title String DEFAULT '',

    updated_at  DateTime64(3, 'UTC'),
    is_deleted  UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(updated_at, is_deleted)
ORDER BY id;

CREATE TABLE IF NOT EXISTS streamlens.proposal_panel
(
    proposal_id String,
    id          String,
    title       String,

    -- The proposal's own copy. Deleting the dashboard this came from does
    -- not touch it, and editing that dashboard does not silently rewrite
    -- the evidence under a pitch someone already read.
    query       String,
    spec        String,

    position    UInt16,
    width       UInt8 DEFAULT 6,
    height      UInt8 DEFAULT 1,

    source_dashboard_id String DEFAULT '',
    source_panel_id     String DEFAULT '',
    -- Lets the UI say "the source chart has changed since this was written"
    -- without ever following the change.
    source_query_hash   String DEFAULT '',

    updated_at  DateTime64(3, 'UTC'),
    is_deleted  UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(updated_at, is_deleted)
ORDER BY (proposal_id, id);

CREATE TABLE IF NOT EXISTS streamlens.proposal_still
(
    proposal_id  String,
    id           String,

    -- Object name inside gs://streamlens-proposals, derived server-side.
    -- The model never supplies, sees, or influences this.
    object       String,
    content_type String,
    bytes        UInt32,

    -- What the model asked for, kept so a generated image can be accounted
    -- for after the fact.
    prompt       String,
    model        String,
    aspect_ratio String,

    position     UInt8,
    updated_at   DateTime64(3, 'UTC'),
    is_deleted   UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(updated_at, is_deleted)
ORDER BY (proposal_id, id);
```

---

## 3. Files to write

### Backend — new

| File | Holds |
|---|---|
| `backend/streamlens/proposals/__init__.py` | Re-exports, mirroring `dashboards/__init__.py` |
| `backend/streamlens/proposals/schema.sql` | The DDL above |
| `backend/streamlens/proposals/spec.py` | `ProposalDoc`, `Archetype`, `parse_doc`, `validate_doc`. Field length caps, genre vocabulary, archetype count bounds. Mirrors `dashboards/spec.py` — problems come back as a list of sentences the model can act on, not exceptions |
| `backend/streamlens/proposals/store.py` | `ensure_schema`, `list_proposals`, `get_proposal`, `create_proposal`, `update_proposal`, `delete_proposal`, `adopt_panel`, `add_proposal_panel`, `update_proposal_panel`, `delete_proposal_panel`, `run_proposal_panel` |
| `backend/streamlens/proposals/stills.py` | Orchestration: build the guarded prompt, call the image model, cap and verify the bytes, write to GCS, insert the row |
| `backend/streamlens/proposals/tools.py` | The model-facing surface (§5) |
| `backend/streamlens/mcp/proposals.py` | `FastMCP` server, `streamable_http_path = "/"`, runnable over stdio. Copy of `mcp/dashboards.py` |
| `backend/streamlens/services/gcp/images.py` | `generate_image(prompt, aspect_ratio, size) -> (bytes, mime)`. One `genai.Client(vertexai=True, location="global")` call, `response_modalities=["TEXT","IMAGE"]`, raises unless `finish_reason == STOP` |
| `backend/streamlens/services/gcp/storage.py` | Bucket client, `put_object(key, data, content_type)`, `read_object(key)`, `delete_prefix(prefix)`. Owns key derivation |

`store.py` **imports** `run_panel_query` and `check_panel` from
`streamlens.dashboards.store` rather than reimplementing them. There must be
exactly one place in the codebase that decides whether model-authored SQL is
allowed to run.

### Backend — edits

| File | Change |
|---|---|
| `config.py` | `proposal_bucket` (`STREAMLENS_PROPOSAL_BUCKET`, default `streamlens-proposals`), `image_model` (`STREAMLENS_IMAGE_MODEL`, default `gemini-3-pro-image`), `max_stills_per_proposal` (3), `max_still_bytes` (12 MB) |
| `mcp/toolset.py` | `proposal_toolset()`, same stdio/HTTP switch on `STREAMLENS_PROPOSAL_MCP_URL` |
| `agents/curator/agent.py` | `build_toolsets()` gains `"proposals": proposal_toolset()`; `INSTRUCTION` gains a "Writing a proposal" section (§5) |
| `api/app.py` | Mount `/mcp/proposals`; call `proposals.store.ensure_schema()` in `lifespan`; add the routes in §4 |
| `api/chat.py` | `MUTATING` += the proposal write tools; `ACTIVITY` += readable labels; emit `{"type": "proposal", "proposal_id": …}` alongside the existing `canvas` event |
| `services/gcp/__init__.py` | Export the two new modules |

### Backend — scripts

| File | Purpose |
|---|---|
| `backend/scripts/seed_proposal.py` | Port the three mock proposals into real rows, adopting panels from the three live dashboards. Same shape as `scripts/seed_gallery.py`. This is what proves §7 before any model is involved |
| `scripts/gcs/gc_proposal_stills.py` | Delete objects under `gs://streamlens-proposals` whose `proposal_still` row is tombstoned or missing. Dry-run by default |

### Web — new routes

All four validate the id with the `^[A-Za-z0-9_-]+$` guard already used in
`api/mock/proposals/[id]/route.ts`, and all four are thin proxies to
`BACKEND_URL`, matching `api/dashboards/route.ts`.

```
web/src/app/api/proposals/route.ts
web/src/app/api/proposals/[id]/route.ts
web/src/app/api/proposals/[id]/panels/[panelId]/route.ts
web/src/app/api/proposals/[id]/stills/[stillId]/route.ts   # streams bytes, immutable cache
```

### Web — edits

| File | Change |
|---|---|
| `lib/proposals.ts` | `/api/mock/proposals` → `/api/proposals`. `Proposal` gains `panels: ProposalPanel[]`, `stills: Still[]`, `source_dashboard_id`, `source_dashboard_title`. `still` becomes `still_url: string \| null` |
| `lib/api.ts` | Extract `PanelView` = `{ id, title, spec, width, height }`. `Panel` and `ProposalPanel` both satisfy it. `PanelData.panel` widens to `PanelView` |
| `lib/layout.ts` | `packRows` only ever reads `width` and spreads the rest, so widen it to `packRows<T extends { width: number }>(panels: T[]): T[]`. No logic change |
| `components/panel.tsx` | `PanelCard` takes `panel: PanelView` and `dataUrl: string` instead of deriving the URL from `panel.dashboard_id`. One renderer, two owners |
| `components/dashboard.tsx` | Pass `dataUrl={`/api/dashboards/${id}/panels/${panel.id}`}` |
| `components/proposal.tsx` | `MarketPanels` reads `proposal.panels` — no dashboard fetch. Hero reads `still_url` with a tone-gradient fallback. Provenance rendered as a soft link (§6) |
| `components/workspace.tsx` | `touchProposal(proposalId)`, mirroring `touchDashboard` |
| `components/chat.tsx` | Handle the `proposal` SSE event → `touchProposal` |
| `components/sidebar.tsx` | `useProposals` fetches `/api/proposals` and re-runs on `revision`, so a newly written proposal appears without a reload. Add the kebab + `ConfirmDelete` the dashboard rows already have |

### Web — delete, once §8 passes

```
web/src/mock/proposals.ts
web/src/app/api/mock/proposals/route.ts
web/src/app/api/mock/proposals/[id]/route.ts
web/public/mock/after-dark-still.png
web/public/mock/home-market-still.png
web/public/mock/ninety-seconds-still.png
```

---

## 4. HTTP surface

```
GET    /api/proposals                              list, for the rail
POST   /api/proposals                              create (typed body, no SQL)
GET    /api/proposals/{id}                          the document, its panels, its stills
DELETE /api/proposals/{id}                          tombstone the lot
GET    /api/proposals/{id}/panels/{panel_id}        replay one panel, read-only
GET    /api/proposals/{id}/stills/{still_id}        stream bytes from GCS
```

`/panels/{panel_id}` is a straight copy of the existing
`panel_data` handler in `api/app.py`: look up the definition, call
`run_panel_query`, return `{panel, columns, types, rows}`. No model in the
path, and no new SQL surface.

---

## 5. Agent surface

Nine tools on `agents/curator`, flat scalar arguments only — the reasoning in
the header of `dashboards/tools.py` applies unchanged. Failures return
`{"ok": false, "problems": [...]}` with the real column list, never a
traceback.

| Tool | Notes |
|---|---|
| `list_proposals()` | |
| `read_proposal(proposal_id)` | Document + panels + `glance` per panel, so the agent can revise without re-querying |
| `create_proposal(title, genre, kicker, budget, hook, logline, connection, story, market, archetype_names, archetype_notes)` | Two parallel lists, validated equal length. Returns `proposal_id` |
| `update_proposal(proposal_id, …all optional…)` | `""` means leave alone, as elsewhere |
| `adopt_panel(proposal_id, dashboard_id, panel_id, title="")` | **The documented default path.** Copies a live panel's query and spec in, records provenance |
| `add_proposal_panel(proposal_id, title, query, chart_type, x, y, …)` | Same signature family as `add_panel`, same `check_panel` gate. For evidence with no dashboard behind it |
| `delete_proposal_panel(proposal_id, panel_id)` | |
| `generate_still(proposal_id, prompt, aspect_ratio="16:9")` | Prompt only. Capped at 3 per proposal |
| `delete_proposal(proposal_id)` | |

Instruction section to add to `agents/curator/agent.py`:

> **# Writing a proposal**
>
> A proposal is a one-sheet for a filmmaker, not a dashboard: a hook, a
> logline, a cast of archetypes, a theme, and charts underneath that justify
> it. Write one when someone asks what they could make, not when they ask what
> the data says.
>
> Find the evidence first. Query the warehouse, or build the dashboard, and let
> the finding pick the idea — not the other way round. Then `create_proposal`
> and `adopt_panel` the charts that carry the argument. Two to four panels. A
> proposal with eight is a dashboard wearing a hat.
>
> Every figure you state in the prose must come from a panel on the proposal or
> a query you actually ran. The story and the archetypes are yours to invent;
> the market is not.
>
> `generate_still` at most once or twice, for mood. Describe a place, a light,
> and a time of day. Never a real person, never a logo, never a real title's
> cast.

---

## 6. Edge cases, and what each does

| Case | Behaviour |
|---|---|
| **Source dashboard deleted** | Proposal unaffected — it owns copies. Provenance renders as plain text instead of a link |
| **Source panel edited later** | Proposal keeps its snapshot. `source_query_hash` lets the UI note "the source chart has changed since this was written". Never auto-follows |
| **Source panel deleted** | Same as above |
| **Adopted query stops running** — table dropped, `youtube.*` TTL expiry, schema change | That one panel renders its own error; the rest of the report renders. Mirror the per-panel failure handling already in `tools.read_panels` |
| **Dashboard id recycled** by a later dashboard with the same slug | Real, because `create_dashboard` only checks live rows. `source_dashboard_title` is written at authoring time, so the label stays honest |
| **Proposal deleted** | Tombstone proposal, panels and stills with three server-side `INSERT … SELECT` statements. Do **not** pull rows through Python first — the comment in `dashboards/store.delete_dashboard` records that as the thing that hung the UI |
| **Proposal deleted while open on the canvas** | Close the tab *before* the DELETE, so in-flight panel queries abort and free the connection. `DashboardRow.remove` already does this; copy it |
| **Stills orphaned in GCS** after a delete | `scripts/gcs/gc_proposal_stills.py`, plus an optional lifecycle rule. Objects are cheap; correctness is that nothing serves them |
| **Two proposals cite the same panel** | Each owns a copy. Independent by construction |
| **Image generation blocked or failed** | Proposal saves without a still. Hero falls back to the tone gradient — no broken `<img>`, no half-written row |
| **Still row exists, object gone** | Route 404s, `<img onError>` falls back to the gradient |
| **Proposal id collision** | Same `slugify` + 4-hex suffix as `create_dashboard` |
| **Proposal with zero panels** | Allowed. A cold idea is legitimate; the marketplace section says there is no chart yet rather than erroring |
| **Agent invents a figure in the prose** | Not preventable in code — mitigated by the instruction, and by the fact that the charts next to the claim are replayed live and will contradict it |

---

## 7. Securing it

**SQL.** Zero new surface. `adopt_panel` and `add_proposal_panel` both route
through the existing `dashboards.store.check_panel` → `run_panel_query`:
`_READ_ONLY_START` regex, the `streamlens_reader` identity, `readonly = 2`,
`max_execution_time = 30`, `max_result_rows = 5000`,
`result_overflow_mode = break`. Proposal *definitions* are written with typed
inserts the model never supplies SQL for, exactly as dashboards are.

**Images.**
- The model passes a prompt. Never a bucket, key, path, URL, content-type, or size.
- Key is `proposals/{proposal_id}/stills/{uuid4().hex}.png`, derived server-side, with `proposal_id` re-validated against `^[a-z0-9][a-z0-9-]{0,63}$` before it reaches a key.
- Reject unless `finish_reason == STOP` and the part is `image/png` or `image/jpeg`. Cap at 12 MB and 3 stills per proposal.
- Append hard constraints to every prompt server-side: no real or identifiable people, no logos or wordmarks, no depiction of an actual title's cast. This matters specifically because the warehouse is about real Netflix titles.
- Store `prompt`, `model` and `aspect_ratio` on the row so any generated image can be accounted for later.
- All output carries a SynthID watermark. Say so in the report footer, in the same spirit as the existing "computed by Streamlens" labelling.

**Bucket.** New, uniform bucket-level access, public access prevention
enforced, us-central1. Never `gs://streamlens-data`. Bytes served only through
the backend route; no public objects, and no signed URL is ever handed to the
model.

**Routes.** Keep the `^[A-Za-z0-9_-]+$` id guard on all four new Next.js
handlers. The still route sets `Cache-Control: private, max-age=31536000,
immutable` — the object never changes — and must not fall through to a
directory listing on a miss.

**Optional hardening.** `streamlens_reader` currently holds `SELECT ON
streamlens.*`, so a model-authored panel query could read the proposal store.
Harmless — it is the agent's own output — but `run_panel_query` needs nothing
from that database, since definitions are read with `shared_client()`. Verify
no other reader path touches `streamlens.*`, then `REVOKE SELECT ON
streamlens.* FROM streamlens_reader`.

---

## 8. Build order

Each phase ends at something you can check, and phase 1 is the one that settles
the dashboard-delete question before any model is involved.

**Phase 0 — provision.** Create the bucket. Add the config fields. Confirm
`gemini-3-pro-image` from the backend venv (already verified once: STOP, one
PNG part, 1.7 MB).

**Phase 1 — store and read API.** `proposals/schema.sql`, `spec.py`,
`store.py`. The six routes in §4, minus stills. Then `seed_proposal.py` to port
the three mock proposals into real rows, adopting panels from the three live
dashboards.
*Check:* `GET /api/proposals/after-dark-after-scroll` returns panels;
`GET …/panels/{id}` returns rows.

**Phase 2 — the acceptance test for the edge case.**
```bash
curl -X DELETE localhost:8000/api/dashboards/youtube-overview
curl localhost:8000/api/proposals/after-dark-after-scroll          # panels still there
curl localhost:8000/api/proposals/after-dark-after-scroll/panels/… # rows still there
```
Both must succeed with the dashboard tombstoned. If they do, the design holds.
Recreate the dashboard afterwards with `scripts/curate.py`.

**Phase 3 — web reads the real thing.** `lib/proposals.ts`, the four proxy
routes, `PanelView` in `lib/api.ts`, `PanelCard`'s `dataUrl`, and
`proposal.tsx` reading `proposal.panels`. Sidebar gains delete.
*Check:* the report renders identically to the mock, on real rows, with
`youtube-overview` still deleted. Then delete the mock files.

**Phase 4 — stills.** `services/gcp/storage.py`, `services/gcp/images.py`,
`proposals/stills.py`, the still route. Regenerate one hero image for a seeded
proposal.
*Check:* image renders through the backend, no public URL exists, row records
prompt and byte count.

**Phase 5 — the agent.** `proposals/tools.py`, `mcp/proposals.py`,
`proposal_toolset()`, the toolset entry and instruction section on
`agents/curator`.
*Check:* `uv run python scripts/curate.py "I'm a filmmaker. Give me an idea
this warehouse can defend."` — watch it query, create, adopt, and generate.

**Phase 6 — canvas wiring.** `proposal` SSE event, `touchProposal`, sidebar
refetch on `revision`.
*Check:* ask in the browser; the proposal opens itself on the canvas as it is
written, the way a dashboard already does.

**Phase 7 — hardening and docs.** GC script. The optional `REVOKE`. Update
`README.md` (the dashboards table and the two-kinds-of-agent section) and
`submission/devpost.md`.

---

## 9. Open decisions

- **Genre vocabulary** — fixed enum, or free text? The report colours the whole
  page from it (`toneFor` in `proposal.tsx` maps Comedy → green, Drama → blue,
  everything else → purple), so free text quietly means "everything is purple".
  Leaning: a small closed set, validated in `spec.py`.
- **`source_query_hash` in v1?** The column is cheap and dropping it later is
  free. The UI affordance for "the source chart has changed" can wait.
- **Stills per proposal** — 3 is the cap; is 1 the norm? Each is ~25 s of
  latency, and the report only shows a hero today.
- **`agents/analyst` naming collision** — worth resolving eventually, out of
  scope here.
