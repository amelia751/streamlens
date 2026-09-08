"""What is actually in the warehouse right now.

Everything here is read from `system.*` at request time. Nothing is
hardcoded, so the UI cannot drift from the instance.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from decimal import Decimal

from streamlens.services.clickhouse.clickhouse_services import shared_client

HIDDEN_DATABASES = ("system", "INFORMATION_SCHEMA", "information_schema")

# ClickPipes provisions a sibling table per destination to capture rows it
# could not parse. They are part of the pipe, not datasets of their own, so
# the UI folds them away instead of listing 17 empty tables.
ERROR_TABLE_SUFFIX = "_clickpipes_error"


@dataclass
class TableInfo:
    name: str
    engine: str
    rows: int
    bytes: int
    kind: str  # data | errors | view

    @property
    def qualified_key(self) -> str:
        return self.name


@dataclass
class DatabaseInfo:
    name: str
    tables: list[TableInfo] = field(default_factory=list)

    @property
    def rows(self) -> int:
        return sum(t.rows for t in self.tables if t.kind == "data")

    @property
    def table_count(self) -> int:
        return sum(1 for t in self.tables if t.kind != "errors")


def _classify(name: str, engine: str) -> str:
    if name.endswith(ERROR_TABLE_SUFFIX):
        return "errors"
    if "View" in engine:
        return "view"
    return "data"


def read_catalog() -> tuple[str, list[DatabaseInfo]]:
    """Return the server version and every non-system database."""
    placeholders = ", ".join(f"'{db}'" for db in HIDDEN_DATABASES)
    client = shared_client()
    version = client.command("SELECT version()")
    result = client.query(
        f"""
        SELECT database, name, engine,
               toUInt64(ifNull(total_rows, 0)),
               toUInt64(ifNull(total_bytes, 0))
        FROM system.tables
        WHERE database NOT IN ({placeholders})
        ORDER BY database, name
        """
    )

    databases: dict[str, DatabaseInfo] = {}
    for database, name, engine, rows, size in result.result_rows:
        databases.setdefault(database, DatabaseInfo(name=database)).tables.append(
            TableInfo(
                name=name,
                engine=engine,
                rows=int(rows),
                bytes=int(size),
                kind=_classify(name, engine),
            )
        )
    return str(version), list(databases.values())


def database_payload(databases: list[DatabaseInfo]) -> list[dict]:
    return [
        {
            "name": db.name,
            "rows": db.rows,
            "table_count": db.table_count,
            "tables": [asdict(t) for t in db.tables],
        }
        for db in databases
    ]


def table_rows_index(databases: list[DatabaseInfo]) -> dict[tuple[str, str], int]:
    """`(database, table) -> rows`, for annotating ingestion destinations."""
    return {(db.name, t.name): t.rows for db in databases for t in db.tables}


def _cell(value: object) -> object:
    """Coerce a ClickHouse value into something JSON can carry.

    FixedString comes back as bytes, and the identifier columns are all
    FixedString, so without this every YouTube table fails to serialise.
    """
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, (list, tuple)):
        return [_cell(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def read_table_preview(database: str, table: str, limit: int) -> dict:
    """Column types and the first `limit` rows of one table.

    The identifiers are checked against `system.tables` before they are
    interpolated. clickhouse-connect cannot bind an identifier as a
    parameter, so nothing that failed that lookup ever reaches the SQL.
    """
    client = shared_client()

    exists = client.query(
        "SELECT engine, toUInt64(ifNull(total_rows, 0)) FROM system.tables "
        "WHERE database = {db:String} AND name = {tbl:String}",
        parameters={"db": database, "tbl": table},
    )
    if not exists.result_rows:
        raise LookupError(f"{database}.{table} does not exist")
    engine, total_rows = exists.result_rows[0]

    columns = client.query(
        "SELECT name, type FROM system.columns "
        "WHERE database = {db:String} AND table = {tbl:String} "
        "ORDER BY position",
        parameters={"db": database, "tbl": table},
    ).result_rows

    preview = client.query(f"SELECT * FROM `{database}`.`{table}` LIMIT {int(limit)}")

    return {
        "database": database,
        "table": table,
        "engine": engine,
        "total_rows": int(total_rows),
        "columns": [{"name": name, "type": type_} for name, type_ in columns],
        "rows": [[_cell(v) for v in row] for row in preview.result_rows],
        "limit": limit,
    }


# Dashboard definitions live in the warehouse but are not a dataset. The
# brief names the tables so the agent does not waste a list_tables on them.
_STORE_DATABASES = frozenset({"streamlens"})

# What a column list does not say.
#
# Every entry here is a property of the data, not advice about a question:
# a grain that is finer than people assume, a type that is not what its name
# suggests, a null that does not mean zero, a coverage figure that makes
# "absent" and "did not happen" different claims. A model reading only
# `view_count:Nullable(UInt64)` will average the nulls as zero and multiply
# duration by views to get "watch time"; both are wrong, and neither is
# discoverable from the schema.
#
# Keep these factual. Anything that reads as "for question X, join Y" does
# not belong here — that is the model's job.
_CAVEATS: dict[str, str] = {
    "landing.netflix_top10_countries": (
        "weekly_rank only — there are NO hours at country grain. Hours exist "
        "globally in netflix_top10_global and all-time in "
        "netflix_top10_most_popular. Country is the finest geography there "
        "is; nothing is sub-national."
    ),
    "landing.netflix_top10_global": (
        "the only weekly hours in the warehouse. `runtime` is the published "
        "runtime of titles that actually charted."
    ),
    "landing.imdb_title_basics": (
        "runtimeMinutes, startYear and endYear are String, with '\\N' for "
        "missing — cast them and handle '\\N', or averages silently drop or "
        "error. No key joins IMDb to Netflix; exact title matching lands "
        "about 83% of Netflix TV titles, and the miss has to be stated."
    ),
    "landing.imdb_title_akas": (
        "`language` and `region` are the only language dimension anywhere in "
        "the warehouse. Netflix data carries no language at all."
    ),
    "landing.vod_clickstream": (
        "671,736 UK desktop sessions, 2017-2019. Real session duration and "
        "hour-of-day, but not current, not global and not mobile."
    ),
    "landing.movielens_ratings": (
        "32M rows, ending 2023-10-13. Aggregate before joining anything to "
        "it; the query ceiling is 30 seconds."
    ),
    "landing.movielens_genome_scores": (
        "18.5M rows over 1,128 tags. Aggregate before joining."
    ),
    "landing.imdb_title_principals": (
        "101.6M rows, the largest table here. Filter by category and "
        "aggregate per person before joining; a per-person average needs a "
        "minimum title count or single-title flukes win."
    ),
    "youtube.video_stats_daily": (
        "ONE snapshot day, not a time series — there is no growth curve for "
        "any video. Cadence over time comes from video.published_at."
    ),
    "youtube.video_stats": (
        "view_count, like_count and comment_count are Nullable because "
        "YouTube returns ABSENT when a creator hides them; averaging nulls "
        "as zero corrupts every rate. duration_s * view_count is NOT watch "
        "time — it assumes every viewer finished, which nothing measures."
    ),
    "youtube.promo_top10_bridge": (
        "links 1,180 of 3,428 Top 10 titles by substring match. A title "
        "absent from the bridge was not matched, which is not the same "
        "claim as not promoted."
    ),
    "youtube.channel": (
        "44 channels. Several are regional aggregates — one channel covers "
        "NORDIC, BENELUX, MENA, LATAM or all of Africa — so 'no channel' "
        "and 'no promotion in that market' are different claims."
    ),
}


def read_schema_brief() -> dict:
    """One compact look at every data table: columns, types, row counts.

    Built for the analyst. `list_databases` + `list_tables` dumps CREATE
    TABLE statements and walks empty/system databases; this skips those and
    returns only what the model needs to write a SELECT.
    """
    client = shared_client()
    hidden = ", ".join(f"'{db}'" for db in HIDDEN_DATABASES)

    today = client.command("SELECT toString(today())")
    tables = client.query(
        f"""
        SELECT database, name, engine, toUInt64(ifNull(total_rows, 0))
        FROM system.tables
        WHERE database NOT IN ({hidden})
          AND name NOT LIKE '%{ERROR_TABLE_SUFFIX}'
        ORDER BY database, name
        """
    ).result_rows
    columns = client.query(
        f"""
        SELECT database, table, name, type
        FROM system.columns
        WHERE database NOT IN ({hidden})
          AND table NOT LIKE '%{ERROR_TABLE_SUFFIX}'
        ORDER BY database, table, position
        """
    ).result_rows

    cols_by_table: dict[tuple[str, str], list[str]] = {}
    for database, table, name, type_ in columns:
        cols_by_table.setdefault((database, table), []).append(f"{name}:{type_}")

    databases: dict[str, list[dict]] = {}
    for database, name, engine, rows in tables:
        entry: dict = {
            "name": name,
            "rows": int(rows),
            "kind": _classify(name, engine),
        }
        if database in _STORE_DATABASES:
            entry["note"] = "dashboard and proposal definitions, not a dataset"
        else:
            entry["columns"] = cols_by_table.get((database, name), [])
            caveat = _CAVEATS.get(f"{database}.{name}")
            if caveat:
                entry["caveat"] = caveat
        databases.setdefault(database, []).append(entry)

    return {
        "today": str(today),
        "databases": [
            {"name": db, "tables": tables_}
            for db, tables_ in databases.items()
        ],
    }


def last_youtube_sync() -> str | None:
    """Newest `fetched_at` in the YouTube dimension tables, if any."""
    result = shared_client().query("SELECT max(fetched_at) FROM youtube.channel")
    if not result.result_rows or result.result_rows[0][0] is None:
        return None
    return result.result_rows[0][0].isoformat()
