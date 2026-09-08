"""ClickHouse Cloud — the partner platform holding the warehouse.

Every service is registered and called in `clickhouse_services.py` — that
one file is the whole surface, and nothing else in the codebase opens a
connection. `catalog.py` and `sources.py` are warehouse *reads* built on
top of it, not service registration.
"""

from streamlens.services.clickhouse import clickhouse_services
from streamlens.services.clickhouse.catalog import read_catalog
from streamlens.services.clickhouse.clickhouse_services import (
    READ_ONLY_SETTINGS,
    SERVICES,
    ClickPipe,
    clickhouse_toolset,
    get_client,
    list_clickpipes,
    ping,
    reader_client,
    run_read_only,
    shared_client,
)
from streamlens.services.clickhouse.sources import read_sources

__all__ = [
    "READ_ONLY_SETTINGS",
    "SERVICES",
    "ClickPipe",
    "clickhouse_services",
    "clickhouse_toolset",
    "get_client",
    "list_clickpipes",
    "ping",
    "read_catalog",
    "read_sources",
    "reader_client",
    "run_read_only",
    "shared_client",
]
