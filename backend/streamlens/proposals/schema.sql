-- Streamlens — agent-authored theme proposals.
--
-- A proposal is a one-sheet for a filmmaker: a hook, a logline, a cast of
-- archetypes, a theme, and charts underneath that justify it. It lives in
-- the warehouse for the same reason a dashboard does — the agent already
-- holds this connection, and the definition stays next to the data it
-- describes instead of drifting in a second store.
--
-- The one thing a proposal does NOT do is point at a dashboard. It owns
-- copies of the panel definitions it cites, so deleting, editing or
-- renaming the dashboard a chart came from cannot touch the pitch. What is
-- kept about the source is a label, never a foreign key: nothing here is
-- dereferenced to render the report.
--
-- Same conventions as dashboards/schema.sql — ReplacingMergeTree keyed on
-- identity, versioned by updated_at, deletes are appends with
-- is_deleted = 1, reads use FINAL.

CREATE DATABASE IF NOT EXISTS streamlens;

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

    -- Provenance, not a foreign key. The title is stored rather than
    -- resolved at read time because create_dashboard only checks live rows
    -- for a slug collision, so a tombstoned id can be recycled by a later,
    -- unrelated dashboard.
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

    -- The proposal's own copy of the definition, with the same columns a
    -- dashboard panel has. The query is stored, never the rows, so the
    -- numbers under a pitch stay live; but the query itself is owned, so
    -- editing the source dashboard does not silently rewrite the evidence
    -- under a pitch someone already read.
    query       String,
    spec        String,

    position    UInt16,
    width       UInt8 DEFAULT 6,
    height      UInt8 DEFAULT 1,

    source_dashboard_id String DEFAULT '',
    source_panel_id     String DEFAULT '',
    -- Lets a later UI say "the source chart has changed since this was
    -- written" without ever following the change.
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

    -- Object name inside the proposal bucket, derived server-side. The
    -- model never supplies, sees, or influences this.
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
