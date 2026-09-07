"""Every way data currently reaches the warehouse, grouped by mechanism.

Three of them, and the differences are not cosmetic:

* **ClickPipes** pull immutable dumps out of GCS into `landing`.
* **The YouTube poller** writes straight to `youtube` because the raw GCS
  zone is never overwritten while the YouTube API Developer Policies
  require public data to be deleted or refreshed within 30 days. Both
  cannot hold for the same bytes, so it skips GCS and every table carries
  a TTL.
* **Refreshable materialized views** move data inside the warehouse.
"""

from __future__ import annotations

from streamlens.services.clickhouse.catalog import (
    DatabaseInfo,
    last_youtube_sync,
    table_rows_index,
)
from streamlens.services.clickhouse.cloud import list_clickpipes

SOURCE_KIND_LABELS = {
    "objectStorage": "Object storage",
    "kafka": "Kafka",
    "postgres": "Postgres CDC",
    "mysql": "MySQL CDC",
    "kinesis": "Kinesis",
}


def _clickpipe_sources(databases: list[DatabaseInfo]) -> list[dict]:
    rows_by_table = table_rows_index(databases)
    groups: dict[str, list[dict]] = {}

    for pipe in list_clickpipes():
        groups.setdefault(pipe.source_kind, []).append(
            {
                "name": pipe.name,
                "state": pipe.state,
                "database": pipe.database,
                "table": pipe.table,
                "rows": rows_by_table.get((pipe.database, pipe.table), 0),
            }
        )

    sources = []
    for kind, streams in sorted(groups.items()):
        states = {s["state"] for s in streams}
        sources.append(
            {
                "id": f"clickpipe-{kind}",
                "mechanism": "ClickPipe",
                "label": SOURCE_KIND_LABELS.get(kind, kind),
                # One state when every pipe agrees, otherwise say so rather
                # than silently reporting the first pipe's status.
                "state": states.pop() if len(states) == 1 else "Mixed",
                "detail": "Managed ingestion from Google Cloud Storage",
                "rows": sum(s["rows"] for s in streams),
                "streams": sorted(streams, key=lambda s: s["name"]),
            }
        )
    return sources


def _youtube_source(databases: list[DatabaseInfo]) -> dict | None:
    youtube = next((db for db in databases if db.name == "youtube"), None)
    if youtube is None:
        return None

    streams = [
        {
            "name": table.name,
            "state": "View" if table.kind == "view" else "Live",
            "database": "youtube",
            "table": table.name,
            "rows": table.rows,
        }
        for table in youtube.tables
        if table.kind != "errors"
    ]

    return {
        "id": "youtube-api",
        "mechanism": "API poll",
        "label": "YouTube Data API",
        "state": "Live",
        "detail": "Written directly, 30-day TTL — never lands in object storage",
        "rows": youtube.rows,
        "last_sync": last_youtube_sync(),
        "streams": streams,
    }


def read_sources(databases: list[DatabaseInfo]) -> list[dict]:
    sources = _clickpipe_sources(databases)
    youtube = _youtube_source(databases)
    if youtube is not None:
        sources.append(youtube)
    return sources
