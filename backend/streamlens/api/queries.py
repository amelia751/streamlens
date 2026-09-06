"""Named, read-only queries that back the dashboards.

The browser never sends SQL. It names a query from this registry and passes
typed parameters, which clickhouse-connect binds server-side. That keeps the
warehouse credentials in the backend and makes the whole surface auditable —
every statement the product can run is in this file.

Anything the *agent* decides to run goes through MCP instead, which is a
separate, also read-only path.

One recurring trap in here: promo counts and Top 10 totals must each be
aggregated to one row per title *before* they are joined. Joining the raw
bridge to a pre-aggregated Top 10 total fans out, once per clip, and
multiplies hours-viewed by the clip count.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Query:
    sql: str
    summary: str
    defaults: dict[str, Any] = field(default_factory=dict)


# --- building blocks -------------------------------------------------------

# One row per Top 10 title. Cumulative weeks is a running counter, so it is
# max() rather than sum().
_TOP10_BY_TITLE = """
    SELECT
        show_title,
        min(weekly_rank)                    AS best_rank,
        max(cumulative_weeks_in_top_10)     AS weeks_charted,
        sum(weekly_hours_viewed)            AS hours_viewed,
        min(week)                           AS first_week,
        max(week)                           AS last_week
    FROM landing.netflix_top10_global
    GROUP BY show_title
"""

_PROMO_BY_TITLE = """
    SELECT
        show_title,
        count()                             AS clips,
        uniqExact(channel_id)               AS channels,
        countIf(is_short)                   AS shorts,
        uniqExact(nullIf(netflix_title_id, 0)) AS netflix_title_ids,
        min(published_at)                   AS first_clip,
        max(published_at)                   AS last_clip
    FROM youtube.promo_top10_bridge
    GROUP BY show_title
"""


QUERIES: dict[str, Query] = {
    # --- shared ------------------------------------------------------------
    "overview": Query(
        summary="Warehouse-wide counters for the landing header.",
        sql="""
        SELECT
            (SELECT count() FROM youtube.channel FINAL)                AS channels,
            (SELECT count() FROM youtube.video FINAL)                  AS videos,
            (SELECT count() FROM youtube.video_stats)                  AS snapshots,
            (SELECT uniqExact(show_title) FROM landing.netflix_top10_global) AS top10_titles,
            (SELECT uniqExact(country_iso2) FROM landing.netflix_top10_countries) AS countries,
            (SELECT uniqExact(show_title) FROM youtube.promo_top10_bridge) AS linked_titles,
            (SELECT max(week) FROM landing.netflix_top10_global)        AS latest_week
        """,
    ),

    # --- 1. The Greenlight Room --------------------------------------------
    "greenlight_board": Query(
        summary="Promo push against Top 10 outcome, one row per title.",
        defaults={"limit": 50, "min_channels": 1},
        sql=f"""
        WITH promo AS ({_PROMO_BY_TITLE}), perf AS ({_TOP10_BY_TITLE})
        SELECT
            promo.show_title        AS title,
            promo.clips             AS clips,
            promo.channels          AS channels,
            promo.shorts            AS shorts,
            perf.best_rank          AS best_rank,
            perf.weeks_charted      AS weeks_charted,
            perf.hours_viewed       AS hours_viewed,
            perf.first_week         AS first_week,
            perf.last_week          AS last_week,
            -- Reach per unit of promo. Labelled in the UI as a Streamlens
            -- metric, not a YouTube or Netflix figure.
            round(perf.hours_viewed / promo.clips)      AS hours_per_clip
        FROM promo
        INNER JOIN perf ON promo.show_title = perf.show_title
        WHERE promo.channels >= {{min_channels:UInt32}}
        ORDER BY promo.channels DESC, promo.clips DESC
        LIMIT {{limit:UInt32}}
        """,
    ),
    "greenlight_kpis": Query(
        summary="Headline counters for the Greenlight Room.",
        sql=f"""
        WITH promo AS ({_PROMO_BY_TITLE}), perf AS ({_TOP10_BY_TITLE})
        SELECT
            count()                                     AS linked_titles,
            sum(promo.clips)                            AS clips,
            max(promo.channels)                         AS widest_campaign,
            countIf(perf.best_rank = 1)                 AS reached_number_one,
            sum(perf.hours_viewed)                      AS hours_viewed
        FROM promo
        INNER JOIN perf ON promo.show_title = perf.show_title
        """,
    ),
    "greenlight_channel_mix": Query(
        summary="Which channel kinds carried a title's campaign.",
        defaults={"title": ""},
        sql="""
        SELECT
            c.market            AS market,
            c.kind              AS kind,
            c.title             AS channel,
            count()             AS clips
        FROM youtube.promo_top10_bridge AS b
        INNER JOIN (SELECT channel_id, title, market, kind FROM youtube.channel FINAL) AS c
            ON b.channel_id = c.channel_id
        WHERE b.show_title = {title:String}
        GROUP BY market, kind, channel
        ORDER BY clips DESC
        """,
    ),

    # --- 2. The Global Rollout ---------------------------------------------
    "rollout_weeks": Query(
        summary="Weeks available in the country Top 10.",
        sql="""
        SELECT DISTINCT week
        FROM landing.netflix_top10_countries
        ORDER BY week DESC
        """,
    ),
    "rollout_countries": Query(
        summary="Country leaderboard for one week and category.",
        defaults={"week": "2026-08-23", "category": "Films", "limit": 200},
        sql="""
        SELECT
            country_iso2    AS country,
            country_name    AS country_name,
            weekly_rank     AS rank,
            show_title      AS title,
            cumulative_weeks_in_top_10 AS weeks_charted
        FROM landing.netflix_top10_countries
        WHERE week = {week:Date} AND category = {category:String}
        ORDER BY country_name, rank
        LIMIT {limit:UInt32}
        """,
    ),
    "rollout_title_footprint": Query(
        summary="Where one title charted, and how high, across all countries.",
        defaults={"title": ""},
        sql="""
        SELECT
            country_iso2    AS country,
            any(country_name) AS country_name,
            min(weekly_rank)  AS best_rank,
            count()           AS weeks_present,
            min(week)         AS first_week,
            max(week)         AS last_week
        FROM landing.netflix_top10_countries
        WHERE show_title = {title:String}
        GROUP BY country
        ORDER BY best_rank, weeks_present DESC
        """,
    ),
    "rollout_global_trajectory": Query(
        summary="Weekly global rank and hours for one title, one row per week.",
        defaults={"title": ""},
        # A title can hold several Top 10 slots in the same week — separate
        # seasons chart independently, and Films and TV are ranked apart. The
        # grain here is deliberately one row per week: best rank achieved and
        # total hours across every simultaneous entry. Returning the raw rows
        # instead makes any line chart zigzag between concurrent placements.
        sql="""
        SELECT
            week,
            argMin(category, weekly_rank)       AS category,
            min(weekly_rank)                    AS rank,
            sum(weekly_hours_viewed)            AS hours_viewed,
            max(cumulative_weeks_in_top_10)     AS weeks_charted,
            count()                             AS entries
        FROM landing.netflix_top10_global
        WHERE show_title = {title:String}
        GROUP BY week
        ORDER BY week
        """,
    ),

    # --- 3. The Promo Machine ----------------------------------------------
    "promo_channels": Query(
        summary="The 44-channel roster with its latest statistics snapshot.",
        sql="""
        WITH latest AS (
            SELECT
                channel_id,
                argMax(subscriber_count, snapshot_ts) AS subscribers,
                argMax(view_count, snapshot_ts)       AS lifetime_views,
                argMax(video_count, snapshot_ts)      AS videos
            FROM youtube.channel_stats
            GROUP BY channel_id
        )
        SELECT
            c.title         AS channel,
            c.handle        AS handle,
            c.kind          AS kind,
            c.market        AS market,
            c.primary_language AS language,
            latest.subscribers     AS subscribers,
            latest.lifetime_views  AS lifetime_views,
            latest.videos          AS videos
        FROM youtube.channel AS c FINAL
        LEFT JOIN latest ON c.channel_id = latest.channel_id
        ORDER BY subscribers DESC
        """,
    ),
    "promo_cadence": Query(
        summary="Monthly upload volume split by Shorts and long form.",
        defaults={"months": 36},
        sql="""
        SELECT
            toStartOfMonth(published_at) AS month,
            countIf(is_short)            AS shorts,
            countIf(NOT is_short)        AS long_form
        FROM youtube.video FINAL
        WHERE published_at >= subtractMonths(now(), {months:UInt32})
        GROUP BY month
        ORDER BY month
        """,
    ),
    "promo_market_mix": Query(
        summary="Catalogue-linked output per market.",
        sql="""
        SELECT
            c.market    AS market,
            c.kind      AS kind,
            count()     AS videos,
            countIf(v.is_short) AS shorts,
            countIf(v.netflix_title_id > 0) AS catalogue_linked
        FROM youtube.video AS v FINAL
        INNER JOIN (SELECT channel_id, market, kind FROM youtube.channel FINAL) AS c
            ON v.channel_id = c.channel_id
        GROUP BY market, kind
        ORDER BY videos DESC
        """,
    ),
    "promo_campaigns": Query(
        summary="Widest campaigns by Netflix catalogue id.",
        defaults={"limit": 40},
        sql="""
        SELECT
            v.netflix_title_id      AS netflix_title_id,
            count()                 AS clips,
            uniqExact(v.channel_id) AS channels,
            groupUniqArray(6)(c.market) AS markets,
            argMin(v.title, v.published_at) AS first_title,
            min(v.published_at)     AS first_clip,
            max(v.published_at)     AS last_clip
        FROM youtube.video AS v FINAL
        INNER JOIN (SELECT channel_id, market FROM youtube.channel FINAL) AS c
            ON v.channel_id = c.channel_id
        WHERE v.netflix_title_id > 0
        GROUP BY netflix_title_id
        ORDER BY channels DESC, clips DESC
        LIMIT {limit:UInt32}
        """,
    ),

    # --- 4. Title dossier (drill-through) ----------------------------------
    "dossier_clips": Query(
        summary="Promo clips for one title, newest first.",
        defaults={"title": "", "limit": 60},
        sql="""
        SELECT
            v.title         AS video_title,
            c.title         AS channel,
            c.market        AS market,
            v.published_at  AS published_at,
            v.duration_s    AS duration_s,
            v.is_short      AS is_short,
            v.netflix_title_id AS netflix_title_id,
            v.video_id      AS video_id
        FROM youtube.promo_top10_bridge AS b
        INNER JOIN (SELECT video_id, title, published_at, duration_s, is_short,
                           netflix_title_id, channel_id
                    FROM youtube.video FINAL) AS v ON b.video_id = v.video_id
        INNER JOIN (SELECT channel_id, title, market FROM youtube.channel FINAL) AS c
            ON v.channel_id = c.channel_id
        WHERE b.show_title = {title:String}
        ORDER BY published_at DESC
        LIMIT {limit:UInt32}
        """,
    ),
    "dossier_reception": Query(
        summary="IMDb reception for one title, matched on primary title.",
        defaults={"title": ""},
        sql="""
        SELECT
            b.primaryTitle  AS imdb_title,
            b.titleType     AS title_type,
            b.startYear     AS start_year,
            r.averageRating AS average_rating,
            r.numVotes      AS num_votes,
            b.tconst        AS tconst
        FROM landing.imdb_title_basics AS b
        INNER JOIN landing.imdb_title_ratings AS r ON b.tconst = r.tconst
        WHERE b.primaryTitle = {title:String}
          AND b.titleType IN ('movie', 'tvSeries', 'tvMiniSeries')
        ORDER BY num_votes DESC
        LIMIT 5
        """,
    ),
}


def get(name: str) -> Query:
    try:
        return QUERIES[name]
    except KeyError:
        raise KeyError(name) from None


def names() -> list[str]:
    return sorted(QUERIES)
