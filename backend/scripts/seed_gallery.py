"""One dashboard holding every chart type, on real warehouse data."""

from streamlens.dashboards import store

DASH = "chart-gallery"

PANELS = [
    (
        "Where the Top 10 lands",
        """
        SELECT country_name AS country, uniqExact(show_title) AS titles
        FROM landing.netflix_top10_countries
        WHERE week >= '2025-01-01'
        GROUP BY country
        ORDER BY titles DESC
        """,
        {"type": "map", "x": "country", "value": "titles", "format": "compact"},
        12, 2,
    ),
    (
        "When people watch",
        """
        SELECT
            toString(toHour(datetime)) AS hour,
            dateName('weekday', datetime) AS weekday,
            toDayOfWeek(datetime) AS dow,
            count() AS plays
        FROM landing.vod_clickstream
        GROUP BY hour, weekday, dow
        ORDER BY dow, toUInt8(hour)
        """,
        {"type": "heatmap", "x": "hour", "y": ["weekday"], "value": "plays", "format": "compact"},
        8, 2,
    ),
    (
        "How far a title climbs",
        """
        SELECT stage, titles FROM (
            SELECT 1 AS ord, 'Reached Top 10' AS stage, uniq(show_title) AS titles
                FROM landing.netflix_top10_countries
            UNION ALL SELECT 2, 'Reached Top 5', uniqIf(show_title, weekly_rank <= 5)
                FROM landing.netflix_top10_countries
            UNION ALL SELECT 3, 'Reached Top 3', uniqIf(show_title, weekly_rank <= 3)
                FROM landing.netflix_top10_countries
            UNION ALL SELECT 4, 'Reached number 1', uniqIf(show_title, weekly_rank = 1)
                FROM landing.netflix_top10_countries
        ) ORDER BY ord
        """,
        {"type": "funnel", "x": "stage", "y": ["titles"], "format": "compact"},
        4, 2,
    ),
    (
        "Top 10 weeks by category and title",
        """
        SELECT category, show_title, count() AS weeks
        FROM landing.netflix_top10_countries
        WHERE week >= '2025-06-01'
        GROUP BY category, show_title
        ORDER BY weeks DESC
        LIMIT 60
        """,
        {"type": "treemap", "path": ["category", "show_title"], "value": "weeks"},
        6, 2,
    ),
    (
        "The same breakdown, nested",
        """
        SELECT category, show_title, count() AS weeks
        FROM landing.netflix_top10_countries
        WHERE week >= '2025-06-01'
        GROUP BY category, show_title
        ORDER BY weeks DESC
        LIMIT 24
        """,
        {"type": "sunburst", "path": ["category", "show_title"], "value": "weeks"},
        6, 2,
    ),
    (
        "What people watch next",
        """
        SELECT src, dst, count() AS moves FROM (
            SELECT
                splitByString(', ', genres)[1] AS src,
                leadInFrame(splitByString(', ', genres)[1])
                    OVER (PARTITION BY user_id ORDER BY datetime
                          ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING) AS dst
            FROM landing.vod_clickstream
            WHERE genres != 'NOT AVAILABLE'
        )
        WHERE dst != '' AND src != dst
        GROUP BY src, dst
        ORDER BY moves DESC
        LIMIT 20
        """,
        {"type": "sankey", "source": "src", "target": "dst", "value": "moves", "format": "compact"},
        7, 2,
    ),
    (
        "Staying power by market",
        """
        SELECT country_name AS country, cumulative_weeks_in_top_10 AS weeks
        FROM landing.netflix_top10_countries
        WHERE country_iso2 IN ('US','GB','BR','JP','IN','FR') AND week >= '2025-01-01'
        LIMIT 5000
        """,
        {"type": "boxplot", "x": "country", "y": ["weeks"]},
        5, 2,
    ),
    (
        "Plays through 2018",
        """
        SELECT toDate(datetime) AS day, count() AS plays
        FROM landing.vod_clickstream
        WHERE datetime >= '2018-01-01' AND datetime < '2019-01-01'
        GROUP BY day ORDER BY day
        """,
        {"type": "calendar", "x": "day", "value": "plays", "format": "compact"},
        12, 2,
    ),
    (
        "Channel shape",
        """
        SELECT title, subscriber_count, view_count, video_count
        FROM (
            SELECT
                c.title,
                s.subscriber_count,
                s.view_count,
                s.video_count,
                row_number() OVER (PARTITION BY s.channel_id ORDER BY s.snapshot_ts DESC) AS rn
            FROM youtube.channel_stats s
            INNER JOIN youtube.channel c ON c.channel_id = s.channel_id
        )
        WHERE rn = 1
        ORDER BY view_count DESC
        LIMIT 5
        """,
        {
            "type": "radar",
            "x": "title",
            "y": ["subscriber_count", "view_count", "video_count"],
            "format": "compact",
        },
        6, 2,
    ),
    (
        "Share of weeks that hit #1",
        """
        SELECT round(countIf(weekly_rank = 1) / count() * 100, 1) AS pct
        FROM landing.netflix_top10_countries
        """,
        {"type": "gauge", "y": ["pct"], "format": "percent"},
        6, 2,
    ),
    (
        "The same watching as a network",
        """
        SELECT src, dst, count() AS moves FROM (
            SELECT
                splitByString(', ', genres)[1] AS src,
                leadInFrame(splitByString(', ', genres)[1])
                    OVER (PARTITION BY user_id ORDER BY datetime
                          ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING) AS dst
            FROM landing.vod_clickstream
            WHERE genres != 'NOT AVAILABLE'
        )
        WHERE dst != '' AND src != dst
        GROUP BY src, dst
        ORDER BY moves DESC
        LIMIT 16
        """,
        {"type": "graph", "source": "src", "target": "dst", "value": "moves", "format": "compact"},
        6, 2,
    ),
    (
        "Category into title",
        """
        SELECT category, show_title, count() AS weeks
        FROM landing.netflix_top10_countries
        WHERE week >= '2025-06-01'
        GROUP BY category, show_title
        ORDER BY weeks DESC
        LIMIT 20
        """,
        {"type": "tree", "path": ["category", "show_title"], "value": "weeks"},
        6, 2,
    ),
    (
        "How the mix shifts",
        """
        SELECT
            toStartOfMonth(datetime) AS month,
            splitByString(', ', genres)[1] AS genre,
            count() AS plays
        FROM landing.vod_clickstream
        WHERE genres != 'NOT AVAILABLE' AND datetime >= '2017-01-01'
        GROUP BY month, genre
        HAVING genre IN ('Drama', 'Comedy', 'Action', 'Documentary', 'Animation')
        ORDER BY month, genre
        """,
        {
            "type": "themeRiver",
            "x": "month",
            "y": ["plays"],
            "series": "genre",
            "format": "compact",
        },
        12, 2,
    ),
    (
        "What people watch next, circular",
        """
        SELECT src, dst, count() AS moves FROM (
            SELECT
                splitByString(', ', genres)[1] AS src,
                leadInFrame(splitByString(', ', genres)[1])
                    OVER (PARTITION BY user_id ORDER BY datetime
                          ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING) AS dst
            FROM landing.vod_clickstream
            WHERE genres != 'NOT AVAILABLE'
        )
        WHERE dst != '' AND src != dst
        GROUP BY src, dst
        ORDER BY moves DESC
        LIMIT 16
        """,
        {"type": "chord", "source": "src", "target": "dst", "value": "moves", "format": "compact"},
        6, 2,
    ),
    (
        "Channel profiles",
        """
        SELECT title, subscriber_count, view_count, video_count
        FROM (
            SELECT
                c.title,
                s.subscriber_count,
                s.view_count,
                s.video_count,
                row_number() OVER (PARTITION BY s.channel_id ORDER BY s.snapshot_ts DESC) AS rn
            FROM youtube.channel_stats s
            INNER JOIN youtube.channel c ON c.channel_id = s.channel_id
        )
        WHERE rn = 1
        ORDER BY view_count DESC
        LIMIT 5
        """,
        {
            "type": "parallel",
            "x": "title",
            "y": ["subscriber_count", "view_count", "video_count"],
            "format": "compact",
        },
        6, 2,
    ),
    (
        "Titles by market, as marks",
        """
        SELECT country_name AS country, uniqExact(show_title) AS titles
        FROM landing.netflix_top10_countries
        WHERE week >= '2025-01-01' AND country_iso2 IN ('US','GB','BR','JP','IN','FR','DE','KR')
        GROUP BY country
        ORDER BY titles DESC
        """,
        {"type": "pictorialBar", "x": "country", "y": ["titles"], "format": "compact"},
        6, 2,
    ),
    (
        "Views against likes",
        """
        SELECT view_count, like_count
        FROM youtube.video_stats
        WHERE view_count > 0 AND like_count > 0
        ORDER BY snapshot_ts DESC
        LIMIT 80
        """,
        {"type": "effectScatter", "x": "view_count", "y": ["like_count"], "format": "compact"},
        6, 2,
    ),
    (
        "Plays, week by week",
        """
        SELECT
            week,
            argMin(plays, dow) AS open,
            argMax(plays, dow) AS close,
            min(plays) AS low,
            max(plays) AS high
        FROM (
            SELECT
                toStartOfWeek(datetime) AS week,
                toDayOfWeek(datetime) AS dow,
                count() AS plays
            FROM landing.vod_clickstream
            WHERE datetime >= '2018-01-01' AND datetime < '2019-01-01'
            GROUP BY week, dow
        )
        GROUP BY week
        ORDER BY week
        """,
        {
            "type": "candlestick",
            "x": "week",
            "y": ["open", "close", "low", "high"],
            "format": "compact",
        },
        12, 2,
    ),
    (
        "Shared Top 10 with the US",
        """
        WITH us AS (
            SELECT DISTINCT show_title
            FROM landing.netflix_top10_countries
            WHERE country_iso2 = 'US' AND week >= '2025-01-01'
        )
        SELECT
            'United States' AS src,
            c.country_name AS dst,
            uniqExact(c.show_title) AS titles
        FROM landing.netflix_top10_countries c
        INNER JOIN us ON us.show_title = c.show_title
        WHERE c.country_iso2 != 'US' AND c.week >= '2025-01-01'
        GROUP BY c.country_name
        ORDER BY titles DESC
        LIMIT 18
        """,
        {"type": "lines", "source": "src", "target": "dst", "value": "titles", "format": "compact"},
        12, 2,
    ),
]


def main() -> None:
    store.ensure_schema()
    try:
        store.delete_dashboard(DASH)
        print("removed the previous gallery")
    except store.DashboardError:
        pass

    created = store.create_dashboard("Chart gallery", "One panel per chart type.")
    assert created == DASH, created

    for title, query, spec, width, height in PANELS:
        result = store.add_panel(
            DASH, title, " ".join(query.split()), spec, width=width, height=height
        )
        ok = result.get("ok", True)
        print(f"{'ok  ' if ok else 'FAIL'} {spec['type']:11} {title}")
        if not ok:
            for problem in result.get("problems", []):
                print(f"       {problem}")

    print(f"\nhttp://localhost:3000/gallery-preview  →  {DASH}")


if __name__ == "__main__":
    main()
