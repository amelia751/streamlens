"""What is actually in the warehouse right now.

Everything here is read from `system.*` at request time. Nothing is
hardcoded, so the UI cannot drift from the instance.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from decimal import Decimal

from streamlens.services.clickhouse.client import shared_client

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


def last_youtube_sync() -> str | None:
    """Newest `fetched_at` in the YouTube dimension tables, if any."""
    result = shared_client().query("SELECT max(fetched_at) FROM youtube.channel")
    if not result.result_rows or result.result_rows[0][0] is None:
        return None
    return result.result_rows[0][0].isoformat()
