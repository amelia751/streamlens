"""Every ClickHouse Cloud service Streamlens uses, registered and called here.

ClickHouse Cloud is the partner platform: it holds the whole warehouse, and
every chart on every page is a `SELECT` against it. This is the single file
to read to see what the product actually does with it. Nothing else in the
codebase opens a connection — the credentials, the clients, the control-plane
calls and the agent's MCP toolset all live below, and the rest of the code
imports from here.

    SERVICES  — the registry, one row per service, with the callable that
                exercises it. `python -m streamlens.services.clickhouse.clickhouse_services`
                runs a live smoke test against every one of them.

| Service            | Interface                        | Used for |
|--------------------|----------------------------------|----------|
| SQL — admin        | HTTPS 8443, `clickhouse-connect` | deterministic reads behind every chart; typed writes of dashboard and proposal definitions |
| SQL — reader       | same, as `streamlens_reader`     | every query the model influenced, under `readonly = 2` |
| Cloud REST API     | api.clickhouse.cloud/v1          | ClickPipes state — the SQL interface cannot see pipes |
| ClickPipes         | managed ingestion                | 17 pipes pulling `gs://streamlens-data/raw/` into `landing.*` |
| MCP server         | `mcp-clickhouse`, read-only      | the agent's own access to the warehouse |

**Two identities, deliberately not mixed.** `default` writes definitions
through typed helpers the model never supplies SQL for.
`streamlens_reader` holds `SELECT` on `landing` and `youtube` and nothing
else — not even on `streamlens` — under a settings profile pinning
`readonly = 2`, a 30-second ceiling and a 5,000-row cap. Every query the
model had a hand in runs as that second identity, so a write is refused by
ClickHouse itself rather than by an application check a future code path
could forget to make. `scripts/clickhouse/create_reader.py` is the source of
truth for those grants.
"""

from __future__ import annotations

import base64
import os
import threading
from dataclasses import dataclass
from typing import Any, Callable

import clickhouse_connect
import httpx
from clickhouse_connect.driver.client import Client
from google.adk.tools.mcp_tool import (
    McpToolset,
    StdioConnectionParams,
    StreamableHTTPConnectionParams,
)
from mcp import StdioServerParameters

from streamlens.config import (
    clickhouse_cloud_settings,
    clickhouse_reader_settings,
    clickhouse_settings,
)

# Pinned so the tool surface the agent sees cannot change under it on a
# `uvx` cache miss.
MCP_CLICKHOUSE_VERSION = "0.6.0"

# Set to run the MCP server on Cloud Run instead of as a local subprocess.
MCP_SERVICE_URL = os.environ.get("STREAMLENS_MCP_URL")

REQUEST_TIMEOUT = 20.0

# The ceilings every model-influenced query runs under. Duplicated in the
# reader's settings profile on the server, so removing them here would not
# widen the boundary.
READ_ONLY_SETTINGS: dict[str, Any] = {
    "readonly": 2,
    "max_execution_time": 30,
    "max_result_rows": 5000,
    # Truncate rather than error when a query is broader than a chart can use.
    "result_overflow_mode": "break",
}

# A clickhouse-connect client carries a server-side session, and a session
# rejects concurrent queries outright. The dashboards fetch four or five
# tiles at once, so a single process-wide client fails as soon as two land
# together, while a client per request throws away the connection and the
# metadata handshake every time. One per thread sits between the two:
# FastAPI runs sync endpoints on a bounded threadpool, so this settles into
# a small, reused pool.
_local = threading.local()


# ------------------------------------------------------ SQL interface


def _connect(settings) -> Client:
    return clickhouse_connect.get_client(
        host=settings.host,
        port=int(settings.port),
        username=settings.user,
        password=settings.password,
        secure=settings.secure,
        verify=settings.verify,
        database=settings.database or "default",
    )


def get_client() -> Client:
    """A fresh admin connection. Prefer `shared_client()` in request paths."""
    return _connect(clickhouse_settings())


def shared_client() -> Client:
    """The admin identity, bound to the calling thread.

    Used by backend code that needs a deterministic query — health checks,
    the named-query registry, every chart route — and by the typed helpers
    that write dashboard and proposal definitions. Nothing the model wrote
    runs here.
    """
    client = getattr(_local, "client", None)
    if client is None:
        client = get_client()
        _local.client = client
    return client


def reader_client() -> Client:
    """The SELECT-only identity, bound to the calling thread.

    Every query the model had a hand in — the MCP server's SQL and each
    stored panel's query — goes through this. The privilege boundary is in
    ClickHouse's own grants, so it holds even if a future code path forgets
    to ask for read-only.
    """
    client = getattr(_local, "reader", None)
    if client is None:
        client = _connect(clickhouse_reader_settings())
        _local.reader = client
    return client


def ping() -> str:
    """The ClickHouse Cloud server version, or raise."""
    with get_client() as client:
        return client.command("SELECT version()")


def run_read_only(query: str, limit: int | None = None) -> Any:
    """Run a SELECT as `streamlens_reader`, under the ceilings above.

    The one place model-authored SQL reaches the warehouse. Callers layer
    their own checks on top — `dashboards.store.run_panel_query` refuses
    anything that is not a single SELECT before it gets here — but this is
    the boundary that holds if they do not.
    """
    settings = dict(READ_ONLY_SETTINGS)
    if limit is not None:
        settings["max_result_rows"] = limit
    return reader_client().query(query, settings=settings)


# ------------------------------------------------ Cloud REST API


@dataclass
class ClickPipe:
    name: str
    state: str
    source_kind: str
    vendor: str | None
    database: str
    table: str


def _source_kind(source: dict) -> str:
    """ClickPipes tags the source by which sub-object is populated."""
    for key, value in source.items():
        if isinstance(value, dict) and value:
            return key
    return "unknown"


def _object_vendor(source: dict) -> str | None:
    """Which cloud an objectStorage pipe reads, from its type or URL host.

    Credentials stay out of this — only the type tag and the host of the
    object URL are used.
    """
    obj = source.get("objectStorage")
    if not isinstance(obj, dict) or not obj:
        return None

    raw = str(obj.get("type") or "").lower()
    if raw in {"gcs", "google", "gcp"}:
        return "gcs"
    if raw in {"s3", "aws", "amazon"}:
        return "s3"
    if "azure" in raw:
        return "azure"

    url = str(obj.get("url") or "")
    if "storage.googleapis.com" in url or url.startswith("gs://"):
        return "gcs"
    if "amazonaws.com" in url or url.startswith("s3://"):
        return "s3"
    if "blob.core.windows.net" in url:
        return "azure"
    return None


def cloud_api_get(url: str) -> dict:
    """One authenticated GET against the ClickHouse Cloud control plane.

    A different credential from the SQL interface: this key manages the
    service — pipes, backups, scaling — and must never reach the browser.
    """
    settings = clickhouse_cloud_settings()
    token = base64.b64encode(
        f"{settings.api_key}:{settings.api_secret}".encode()
    ).decode()
    response = httpx.get(
        url,
        headers={"Authorization": f"Basic {token}"},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


def list_clickpipes() -> list[ClickPipe]:
    """Every ClickPipe on the service. The SQL interface cannot see these."""
    body = cloud_api_get(clickhouse_cloud_settings().clickpipes_url)

    pipes = []
    for entry in body.get("result", []):
        destination = entry.get("destination", {})
        source = entry.get("source", {})
        pipes.append(
            ClickPipe(
                name=entry.get("name", ""),
                state=entry.get("state", "Unknown"),
                source_kind=_source_kind(source),
                vendor=_object_vendor(source),
                database=destination.get("database", ""),
                table=destination.get("table", ""),
            )
        )
    return sorted(pipes, key=lambda p: p.name)


# ------------------------------------------------------- MCP server


def _http_toolset(url: str, timeout: float) -> McpToolset:
    """The MCP server as it runs deployed: Cloud Run, behind Google IAM.

    Agent Runtime cannot spawn a subprocess, so this is the deployed path.
    The ID token is minted by `services.gcp.gcp_services`, which is the only
    place Google credentials are constructed.
    """
    from streamlens.services.gcp.gcp_services import cloud_run_client_factory

    audience = url.split("/mcp")[0].rstrip("/")
    return McpToolset(
        connection_params=StreamableHTTPConnectionParams(
            url=url,
            timeout=timeout,
            httpx_client_factory=cloud_run_client_factory(audience),
        ),
    )


def _stdio_toolset(timeout: float) -> McpToolset:
    """The MCP server as it runs locally: a `uvx` subprocess.

    `CLICKHOUSE_ALLOW_WRITE_ACCESS` is absent from `mcp_env()`, so the
    server refuses INSERT, ALTER and DROP on both transports.
    """
    return McpToolset(
        connection_params=StdioConnectionParams(
            server_params=StdioServerParameters(
                command="uvx",
                args=[
                    "--from",
                    f"mcp-clickhouse=={MCP_CLICKHOUSE_VERSION}",
                    "--python",
                    "3.13",
                    "mcp-clickhouse",
                ],
                env=clickhouse_settings().mcp_env(),
            ),
            timeout=timeout,
        ),
    )


def clickhouse_toolset(timeout: float = 120.0) -> McpToolset:
    """The read-only ClickHouse Cloud MCP toolset the agent explores with.

    The agent never gets a database handle. It gets MCP tools
    (`list_databases`, `list_tables`, `run_query`, ...) served by the
    official `mcp-clickhouse` server, pointed at the `streamlens` service.

    We run the OSS server rather than the hosted `mcp.clickhouse.cloud`
    endpoint because that one authenticates through an interactive OAuth
    browser flow, which a headless backend cannot complete.
    """
    if MCP_SERVICE_URL:
        return _http_toolset(MCP_SERVICE_URL, timeout)
    return _stdio_toolset(timeout)


# ------------------------------------------------------ the registry


@dataclass(frozen=True)
class Service:
    """One ClickHouse Cloud service, and the call that proves we use it."""

    name: str
    interface: str
    used_for: str
    entrypoint: str
    smoke: Callable[[], str] | None = None


def _smoke_sql_admin() -> str:
    client = shared_client()
    version = client.command("SELECT version()")
    rows = client.query(
        "SELECT database, count() FROM system.tables "
        "WHERE database IN ('landing','youtube','streamlens') "
        "GROUP BY database ORDER BY database"
    ).result_rows
    shape = ", ".join(f"{db}:{n}" for db, n in rows)
    return f"server {version} — {shape}"


def _smoke_sql_reader() -> str:
    result = run_read_only("SELECT count() FROM youtube.video", limit=1)
    videos = result.result_rows[0][0]
    try:
        reader_client().command("INSERT INTO youtube.video (video_id) VALUES ('x')")
    except Exception:
        refused = True
    else:
        refused = False
    return (
        f"read {videos:,} youtube.video rows as streamlens_reader; "
        f"write {'refused by the server' if refused else 'WAS NOT REFUSED — check grants'}"
    )


def _smoke_cloud_api() -> str:
    pipes = list_clickpipes()
    states = {}
    for pipe in pipes:
        states[pipe.state] = states.get(pipe.state, 0) + 1
    shape = ", ".join(f"{n} {state}" for state, n in sorted(states.items()))
    return f"{len(pipes)} ClickPipes on the service ({shape})"


def _smoke_clickpipes_landing() -> str:
    rows = shared_client().query(
        "SELECT count(), sum(total_rows) FROM system.tables WHERE database = 'landing'"
    ).result_rows[0]
    return f"{rows[0]} landing tables holding {int(rows[1] or 0):,} rows"


def _smoke_stores() -> str:
    rows = shared_client().query(
        """
        SELECT
            (SELECT count() FROM streamlens.dashboard FINAL WHERE is_deleted = 0),
            (SELECT count() FROM streamlens.panel FINAL WHERE is_deleted = 0),
            (SELECT count() FROM streamlens.proposal FINAL WHERE is_deleted = 0),
            (SELECT count() FROM streamlens.proposal_panel FINAL WHERE is_deleted = 0)
        """
    ).result_rows[0]
    return (
        f"{rows[0]} dashboards / {rows[1]} panels, "
        f"{rows[2]} proposals / {rows[3]} adopted charts"
    )


def _smoke_mcp() -> str:
    import asyncio

    async def tools() -> list[str]:
        toolset = clickhouse_toolset()
        try:
            return [t.name for t in await toolset.get_tools()]
        finally:
            await toolset.close()

    names = asyncio.run(tools())
    transport = "Cloud Run over HTTP" if MCP_SERVICE_URL else "local uvx subprocess"
    return f"{len(names)} read-only tools over {transport}: {', '.join(sorted(names))}"


SERVICES: tuple[Service, ...] = (
    Service(
        "SQL — admin (`default`)",
        "HTTPS 8443, clickhouse-connect",
        "deterministic reads behind every chart; typed writes of definitions",
        "clickhouse_services.shared_client",
        _smoke_sql_admin,
    ),
    Service(
        "SQL — reader (`streamlens_reader`)",
        "HTTPS 8443, readonly = 2",
        "every query the model influenced, including each stored panel query",
        "clickhouse_services.reader_client / run_read_only",
        _smoke_sql_reader,
    ),
    Service(
        "Cloud REST API",
        "api.clickhouse.cloud/v1",
        "ClickPipes state — the SQL interface cannot see pipes",
        "clickhouse_services.list_clickpipes",
        _smoke_cloud_api,
    ),
    Service(
        "ClickPipes",
        "managed ingestion from GCS",
        "pulls gs://streamlens-data/raw/ into landing.*",
        "scripts/clickhouse/gcs_pipes.py",
        _smoke_clickpipes_landing,
    ),
    Service(
        "ReplacingMergeTree stores",
        "streamlens.*",
        "dashboards and proposals live in the warehouse they describe",
        "dashboards.store / proposals.store",
        _smoke_stores,
    ),
    Service(
        "MCP server",
        "mcp-clickhouse, read-only",
        "the agent's own access to the warehouse",
        "clickhouse_services.clickhouse_toolset",
        _smoke_mcp,
    ),
)


def main() -> None:
    """Call every registered service for real and report what came back.

        uv run python -m streamlens.services.clickhouse.clickhouse_services
    """
    settings = clickhouse_settings()
    cloud = clickhouse_cloud_settings()
    print(f"service {cloud.service_name} · {settings.host}:{settings.port}\n")

    for service in SERVICES:
        if service.smoke is None:
            print(f"  --   {service.name}: {service.entrypoint} (not smoke-tested)")
            continue
        try:
            print(f"  ok   {service.name}: {service.smoke()}")
        except Exception as exc:
            print(f"  FAIL {service.name}: {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
