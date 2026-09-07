-- Streamlens — agent-authored dashboards.
--
-- Dashboards live in the warehouse they describe. That is deliberate: the
-- agent already holds a ClickHouse connection, the sidebar already mirrors
-- this instance, and it keeps the definition next to the data instead of in
-- a second store that can drift.
--
-- The shape follows ClickHouse's own `system.dashboards`, which is just
-- (dashboard, title, query). A panel here is that plus the semantic spec
-- needed to draw it and its place in the grid.
--
-- Both tables are ReplacingMergeTree keyed on identity and versioned by
-- updated_at, so an edit is an insert of a newer row and a delete is an
-- insert with is_deleted = 1. The agent never issues UPDATE or DELETE, which
-- ClickHouse would run as an expensive mutation; every write is an append and
-- reads use FINAL.

CREATE DATABASE IF NOT EXISTS streamlens;

CREATE TABLE IF NOT EXISTS streamlens.dashboard
(
    id          String,
    title       String,
    description String,

    updated_at  DateTime64(3, 'UTC'),
    is_deleted  UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(updated_at, is_deleted)
ORDER BY id;

CREATE TABLE IF NOT EXISTS streamlens.panel
(
    dashboard_id String,
    id           String,
    title        String,

    -- The query is stored, never the rows. A panel re-runs against live data
    -- on every load, so a dashboard cannot go stale.
    query        String,

    -- The semantic spec as JSON: chart type and which columns map to which
    -- channel. Deliberately not a rendering library's own format — the model
    -- writes intent and the compiler decides the geometry.
    spec         String,

    position     UInt16,
    -- Grid units out of 12, matching the canvas layout.
    width        UInt8 DEFAULT 6,
    height       UInt8 DEFAULT 1,

    updated_at   DateTime64(3, 'UTC'),
    is_deleted   UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(updated_at, is_deleted)
ORDER BY (dashboard_id, id);
