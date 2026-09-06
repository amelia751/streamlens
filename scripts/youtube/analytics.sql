-- Streamlens — derived analytics layer
--
-- schema.sql holds the raw ingest tables. This file holds everything computed
-- on top of them. Kept separate so a re-run of one never clobbers the other.
--
-- The centrepiece is promo_top10_bridge, which links a YouTube promo clip to
-- the Netflix Weekly Top 10 title it is promoting. Matching is a substring
-- test of the Top 10 show title inside the video title, which is a cross
-- product (3.4k titles x ~183k videos). That is far too slow to run per page
-- load, so it is materialised here and refreshed on a schedule instead.
--
-- Rows are YouTube-derived, so the table carries the same 30-day TTL as the
-- rest of the youtube database. The hourly full refresh renews it well inside
-- that window.

CREATE TABLE IF NOT EXISTS youtube.promo_top10_bridge
(
    show_title          String,
    video_id            FixedString(11),
    channel_id          FixedString(24),
    netflix_title_id    UInt64,
    published_at        DateTime('UTC'),
    is_short            UInt8,
    built_at            DateTime('UTC')
)
ENGINE = MergeTree
PARTITION BY tuple()
ORDER BY (show_title, video_id)
TTL built_at + INTERVAL 30 DAY;

-- length >= 8 drops short generic titles ("Blood", "Creature") that would
-- otherwise substring-match unrelated clips and inflate every campaign.
CREATE MATERIALIZED VIEW IF NOT EXISTS youtube.promo_top10_bridge_mv
REFRESH EVERY 1 HOUR RANDOMIZE FOR 5 MINUTE
TO youtube.promo_top10_bridge AS
WITH top10 AS
(
    SELECT DISTINCT show_title
    FROM landing.netflix_top10_global
    WHERE length(show_title) >= 8
),
clips AS
(
    SELECT video_id, channel_id, netflix_title_id, published_at, title, is_short
    FROM youtube.video FINAL
    WHERE privacy_status = 'public'
)
SELECT
    top10.show_title        AS show_title,
    clips.video_id          AS video_id,
    clips.channel_id        AS channel_id,
    clips.netflix_title_id  AS netflix_title_id,
    clips.published_at      AS published_at,
    clips.is_short          AS is_short,
    now()                   AS built_at
FROM top10
INNER JOIN clips ON position(clips.title, top10.show_title) > 0;
