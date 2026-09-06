-- Streamlens — YouTube (Netflix-operated channels)
--
-- YouTube is the one source that does NOT pass through gs://streamlens-data/raw/.
-- The raw zone is immutable and never overwritten; the YouTube API Developer
-- Policies (III.E.4) require public API data to be deleted or refreshed within
-- 30 calendar days. Those two rules are incompatible, so YouTube writes straight
-- here and every table below carries a TTL.
--
-- Retention is split by what the policy actually says:
--
--   content  (titles, descriptions, tags, comment text)  30 days, always
--   metrics  (view/like/comment counts)                  30 days, or 36 months
--                                                        for audited developers
--
-- To adopt the 36-month statistics window after an approved audit, only the two
-- lines marked AUDIT-GATED change. Nothing else in the schema moves.

CREATE DATABASE IF NOT EXISTS youtube;

-- ---------------------------------------------------------------------------
-- Dimensions. ReplacingMergeTree keyed on identity, versioned by fetched_at.
-- The TTL expression is relative to fetched_at, so re-fetching a row renews it.
-- That is literally the policy's "delete or refresh" rule expressed as DDL.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS youtube.channel
(
    channel_id          FixedString(24),
    fetched_at          DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),

    -- from scripts/youtube/channels.json, not from the API
    handle              LowCardinality(String),
    kind                LowCardinality(String),   -- regional|genre|cobrand|title|corporate
    market              LowCardinality(String),
    primary_language    LowCardinality(String),

    title               String,
    description         String CODEC(ZSTD(3)),
    reported_country    LowCardinality(String),
    published_at        DateTime('UTC'),
    uploads_playlist_id FixedString(24),

    is_deleted          UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(fetched_at, is_deleted)
PARTITION BY tuple()
ORDER BY channel_id
TTL fetched_at + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS youtube.video
(
    video_id            FixedString(11),
    fetched_at          DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    channel_id          FixedString(24),

    title               String,
    description         String CODEC(ZSTD(3)),
    tags                Array(String) CODEC(ZSTD(3)),
    published_at        DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    category_id         LowCardinality(String),
    default_language    LowCardinality(String),
    default_audio_language LowCardinality(String),

    duration_s          UInt32,
    -- ~50% of recent Netflix uploads are Shorts. Mixing them with trailers in a
    -- single view-count metric is meaningless, so this is a first-class column.
    is_short            UInt8 MATERIALIZED duration_s <= 60,
    definition          LowCardinality(String),
    has_caption         UInt8,
    live_content        LowCardinality(String),
    made_for_kids       UInt8,
    privacy_status      LowCardinality(String),

    -- Netflix writes its own catalog ID into the description:
    --   https://www.netflix.com/title/81991579
    -- Present on ~60% of videos overall and 80-94% on the main promo channels.
    -- Joins every trailer for one title across all 44 channels and 20+ languages
    -- with no fuzzy title matching. 0 = absent.
    netflix_title_id    UInt64 DEFAULT 0,

    is_deleted          UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(fetched_at, is_deleted)
PARTITION BY toYYYYMM(published_at)
ORDER BY video_id
TTL fetched_at + INTERVAL 30 DAY;

-- ---------------------------------------------------------------------------
-- Metric snapshots. Append-only: a snapshot at T is a new observation, not a
-- correction of T-1, so deduplicating would destroy the series.
--
-- Counters are Nullable and never DEFAULT 0. The API omits the field entirely
-- when a creator hides likes or disables comments; collapsing absent to zero
-- manufactures a multi-million-row negative delta the moment that happens.
-- stats_flags records why a value is NULL.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS youtube.video_stats
(
    video_id        FixedString(11),
    snapshot_ts     DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
    channel_id      FixedString(24),

    view_count      Nullable(UInt64) CODEC(ZSTD(1)),
    like_count      Nullable(UInt64) CODEC(ZSTD(1)),
    comment_count   Nullable(UInt64) CODEC(ZSTD(1)),

    -- bit 0 views hidden | bit 1 likes hidden | bit 2 comments disabled
    -- bit 3 made-for-kids | bit 4 not embeddable
    stats_flags     UInt8 DEFAULT 0,
    fetch_run_id    UUID
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(snapshot_ts)
ORDER BY (video_id, snapshot_ts)
TTL snapshot_ts + INTERVAL 30 DAY;          -- AUDIT-GATED -> INTERVAL 36 MONTH

CREATE TABLE IF NOT EXISTS youtube.channel_stats
(
    channel_id          FixedString(24),
    snapshot_ts         DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),

    subscriber_count    Nullable(UInt64) CODEC(ZSTD(1)),
    view_count          Nullable(UInt64) CODEC(ZSTD(1)),
    video_count         Nullable(UInt64) CODEC(ZSTD(1)),

    stats_flags         UInt8 DEFAULT 0,     -- bit 0 subscriber count hidden
    fetch_run_id        UUID
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(snapshot_ts)
ORDER BY (channel_id, snapshot_ts)
TTL snapshot_ts + INTERVAL 30 DAY;          -- AUDIT-GATED -> INTERVAL 36 MONTH

-- ---------------------------------------------------------------------------
-- Daily rollup.
--
-- Fed by a REFRESHABLE materialized view, not an incremental one. An incremental
-- MV only sees rows in the arriving insert block, so it structurally cannot
-- compute a delta against the previous snapshot. A full atomic recompute is
-- idempotent, self-heals against late or backfilled fetches, and needs no
-- watermark bookkeeping.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS youtube.video_stats_daily
(
    day             Date,
    video_id        FixedString(11),
    channel_id      FixedString(24),

    view_count_eod  Nullable(UInt64),
    like_count_eod  Nullable(UInt64),
    comment_count_eod Nullable(UInt64),

    views_gained    UInt64,     -- clamped at 0
    likes_gained    UInt64,

    -- A view count going DOWN means YouTube purged bot views. That is an
    -- editorial event worth keeping, not noise to clamp away silently.
    purge_events    UInt8,
    snapshots       UInt16
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(day)
ORDER BY (video_id, day)
TTL day + INTERVAL 30 DAY;                  -- AUDIT-GATED -> INTERVAL 36 MONTH

CREATE MATERIALIZED VIEW IF NOT EXISTS youtube.video_stats_daily_mv
REFRESH EVERY 1 DAY OFFSET 2 HOUR RANDOMIZE FOR 10 MINUTE
TO youtube.video_stats_daily AS
WITH ranked AS
(
    SELECT
        video_id,
        channel_id,
        snapshot_ts,
        view_count,
        like_count,
        comment_count,
        lagInFrame(view_count) OVER w AS prev_views,
        lagInFrame(like_count) OVER w AS prev_likes
    FROM youtube.video_stats
    WINDOW w AS (
        PARTITION BY video_id ORDER BY snapshot_ts
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    )
)
SELECT
    toDate(snapshot_ts)                                     AS day,
    video_id,
    any(channel_id)                                         AS channel_id,
    argMax(view_count, snapshot_ts)                         AS view_count_eod,
    argMax(like_count, snapshot_ts)                         AS like_count_eod,
    argMax(comment_count, snapshot_ts)                      AS comment_count_eod,
    sum(greatest(toInt64(view_count) - toInt64(prev_views), 0))  AS views_gained,
    sum(greatest(toInt64(like_count) - toInt64(prev_likes), 0))  AS likes_gained,
    countIf(view_count < prev_views)                        AS purge_events,
    count()                                                 AS snapshots
FROM ranked
GROUP BY day, video_id;

-- ---------------------------------------------------------------------------
-- Identity bridge. NOT YouTube data and therefore NOT TTL'd.
--
-- Maps Netflix's own catalog ID to TMDB. Both sides are non-YouTube identifiers,
-- so nothing here falls under the 30-day rule. The video_id -> netflix_title_id
-- edge is YouTube-derived and lives in youtube.video, where it does expire.
--
-- There is no public authority for this mapping. It is reconstructed by matching
-- title + year against the TMDB data we already pull, so every row carries a
-- confidence score and must be labelled as reconstructed, never ground truth.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS youtube.netflix_title_bridge
(
    netflix_title_id    UInt64,
    tmdb_id             UInt64,
    tmdb_media_type     LowCardinality(String),   -- movie|tv
    matched_title       String,
    matched_year        UInt16,
    match_method        LowCardinality(String),   -- exact|title_year|fuzzy|manual
    confidence          Float32,
    resolved_at         DateTime('UTC'),
    is_deleted          UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(resolved_at, is_deleted)
PARTITION BY tuple()
ORDER BY (netflix_title_id, tmdb_id);
