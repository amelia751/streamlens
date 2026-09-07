"""Reading and writing dashboards, and running the queries behind them.

Two separate privileges live here and are deliberately not mixed:

* Panel queries are run with `readonly = 2`, so a panel can never mutate the
  warehouse no matter what the model wrote.
* Dashboard definitions are written with ordinary inserts, but only through
  the typed helpers below — the model never supplies the SQL for those.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from streamlens.dashboards.spec import PanelSpec, parse_spec, validate_spec
from streamlens.services.clickhouse.catalog import _cell
from streamlens.services.clickhouse.client import reader_client, shared_client

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# A panel is a chart, so its query must return rows and nothing else.
_READ_ONLY_START = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)

PANEL_ROW_LIMIT = 5000
QUERY_TIMEOUT_SECONDS = 30


class DashboardError(ValueError):
    """Raised with a message written to be read by the model."""


@dataclass
class Panel:
    dashboard_id: str
    id: str
    title: str
    query: str
    spec: PanelSpec
    position: int
    width: int
    height: int

    def to_dict(self) -> dict:
        return {
            "dashboard_id": self.dashboard_id,
            "id": self.id,
            "title": self.title,
            "query": self.query,
            "spec": self.spec.to_dict(),
            "position": self.position,
            "width": self.width,
            "height": self.height,
        }


@dataclass
class Dashboard:
    id: str
    title: str
    description: str
    panels: list[Panel]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "panels": [p.to_dict() for p in self.panels],
        }


def _statements(sql: str) -> list[str]:
    """Split a schema file into executable statements.

    Comments are stripped before the split, not after: prose in this file
    contains semicolons, and splitting first would cut a statement in half
    at a semicolon that was only ever punctuation.
    """
    body = "\n".join(
        line for line in sql.splitlines() if not line.strip().startswith("--")
    )
    return [s for s in (chunk.strip() for chunk in body.split(";")) if s]


def ensure_schema() -> None:
    """Create the dashboard tables if they are not there yet."""
    client = shared_client()
    for statement in _statements(SCHEMA_PATH.read_text()):
        client.command(statement)


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:60] or uuid.uuid4().hex[:8]


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------- queries


def run_panel_query(query: str, limit: int = PANEL_ROW_LIMIT) -> dict[str, Any]:
    """Run a panel's query read-only and return its columns and rows.

    `readonly = 2` permits SELECT and per-query settings but rejects every
    write, so this is safe to point at model-authored SQL.
    """
    if not _READ_ONLY_START.match(query):
        raise DashboardError(
            "a panel query must be a single SELECT (or WITH ... SELECT) statement"
        )

    # The reader identity cannot write at all; readonly and the ceilings below
    # are a second layer, not the only one.
    try:
        result = reader_client().query(
            query,
            settings={
                "readonly": 2,
                "max_execution_time": QUERY_TIMEOUT_SECONDS,
                "max_result_rows": limit,
                # Truncate rather than error when a query is broader than a
                # chart can use.
                "result_overflow_mode": "break",
            },
        )
    except Exception as exc:
        raise DashboardError(f"query failed: {exc}") from exc

    return {
        "columns": list(result.column_names),
        "types": [t.name for t in result.column_types],
        "rows": [[_cell(v) for v in row] for row in result.result_rows],
    }


def check_panel(query: str, spec_raw: dict) -> dict[str, Any]:
    """Run a panel's query and confirm the spec can be drawn from it.

    This is the gate every write goes through. It returns the columns and a
    few sample rows so the caller — usually the model — can see what it
    actually got back.
    """
    spec = parse_spec(spec_raw)
    result = run_panel_query(query, limit=200)
    problems = validate_spec(spec, result["columns"])
    return {
        "ok": not problems,
        "problems": problems,
        "columns": result["columns"],
        "types": result["types"],
        "sample_rows": result["rows"][:5],
        "row_count": len(result["rows"]),
        "spec": spec.to_dict(),
    }


# ------------------------------------------------------------ dashboards


def list_dashboards() -> list[dict[str, Any]]:
    rows = shared_client().query(
        """
        SELECT d.id, d.title, d.description, ifNull(p.n, 0)
        FROM streamlens.dashboard AS d FINAL
        LEFT JOIN (
            SELECT dashboard_id, count() AS n
            FROM streamlens.panel FINAL
            WHERE is_deleted = 0
            GROUP BY dashboard_id
        ) AS p ON p.dashboard_id = d.id
        WHERE d.is_deleted = 0
        ORDER BY d.updated_at DESC
        """
    ).result_rows
    return [
        {"id": r[0], "title": r[1], "description": r[2], "panel_count": int(r[3])}
        for r in rows
    ]


def get_dashboard(dashboard_id: str) -> Dashboard:
    client = shared_client()
    head = client.query(
        "SELECT id, title, description FROM streamlens.dashboard FINAL "
        "WHERE id = {id:String} AND is_deleted = 0",
        parameters={"id": dashboard_id},
    ).result_rows
    if not head:
        raise DashboardError(f"no dashboard with id {dashboard_id!r}")

    panels = client.query(
        "SELECT id, title, query, spec, position, width, height "
        "FROM streamlens.panel FINAL "
        "WHERE dashboard_id = {id:String} AND is_deleted = 0 "
        "ORDER BY position, id",
        parameters={"id": dashboard_id},
    ).result_rows

    return Dashboard(
        id=head[0][0],
        title=head[0][1],
        description=head[0][2],
        panels=[
            Panel(
                dashboard_id=dashboard_id,
                id=p[0],
                title=p[1],
                query=p[2],
                spec=parse_spec(json.loads(p[3])),
                position=int(p[4]),
                width=int(p[5]),
                height=int(p[6]),
            )
            for p in panels
        ],
    )


def create_dashboard(title: str, description: str = "") -> str:
    if not title.strip():
        raise DashboardError("a dashboard needs a title")

    dashboard_id = slugify(title)
    existing = shared_client().query(
        "SELECT count() FROM streamlens.dashboard FINAL "
        "WHERE id = {id:String} AND is_deleted = 0",
        parameters={"id": dashboard_id},
    ).result_rows
    if existing and existing[0][0]:
        dashboard_id = f"{dashboard_id}-{uuid.uuid4().hex[:4]}"

    shared_client().insert(
        "streamlens.dashboard",
        [[dashboard_id, title, description, _now(), 0]],
        column_names=["id", "title", "description", "updated_at", "is_deleted"],
    )
    return dashboard_id


def update_dashboard(
    dashboard_id: str,
    title: str | None = None,
    description: str | None = None,
) -> None:
    current = get_dashboard(dashboard_id)
    shared_client().insert(
        "streamlens.dashboard",
        [
            [
                dashboard_id,
                title if title is not None else current.title,
                description if description is not None else current.description,
                _now(),
                0,
            ]
        ],
        column_names=["id", "title", "description", "updated_at", "is_deleted"],
    )


def delete_dashboard(dashboard_id: str) -> int:
    """Tombstone a dashboard and every panel on it."""
    dashboard = get_dashboard(dashboard_id)
    client = shared_client()
    client.insert(
        "streamlens.dashboard",
        [[dashboard_id, dashboard.title, dashboard.description, _now(), 1]],
        column_names=["id", "title", "description", "updated_at", "is_deleted"],
    )
    for panel in dashboard.panels:
        _write_panel(panel, deleted=True)
    return len(dashboard.panels)


# ---------------------------------------------------------------- panels


def _write_panel(panel: Panel, deleted: bool = False) -> None:
    shared_client().insert(
        "streamlens.panel",
        [
            [
                panel.dashboard_id,
                panel.id,
                panel.title,
                panel.query,
                json.dumps(panel.spec.to_dict()),
                panel.position,
                panel.width,
                panel.height,
                _now(),
                1 if deleted else 0,
            ]
        ],
        column_names=[
            "dashboard_id",
            "id",
            "title",
            "query",
            "spec",
            "position",
            "width",
            "height",
            "updated_at",
            "is_deleted",
        ],
    )


def add_panel(
    dashboard_id: str,
    title: str,
    query: str,
    spec_raw: dict,
    width: int = 6,
    height: int = 1,
) -> dict[str, Any]:
    """Validate a panel, then persist it. Returns the check result."""
    dashboard = get_dashboard(dashboard_id)
    check = check_panel(query, spec_raw)
    if not check["ok"]:
        return check

    panel = Panel(
        dashboard_id=dashboard_id,
        id=f"{slugify(title)}-{uuid.uuid4().hex[:4]}",
        title=title,
        query=query,
        spec=parse_spec(check["spec"]),
        position=len(dashboard.panels),
        width=max(3, min(12, width)),
        height=max(1, min(3, height)),
    )
    _write_panel(panel)
    check["panel_id"] = panel.id
    return check


def update_panel(
    dashboard_id: str,
    panel_id: str,
    title: str | None = None,
    query: str | None = None,
    spec_raw: dict | None = None,
    width: int | None = None,
    height: int | None = None,
    position: int | None = None,
) -> dict[str, Any]:
    """Change one panel in place. Only the fields supplied are touched."""
    dashboard = get_dashboard(dashboard_id)
    current = next((p for p in dashboard.panels if p.id == panel_id), None)
    if current is None:
        known = ", ".join(p.id for p in dashboard.panels) or "none"
        raise DashboardError(
            f"no panel {panel_id!r} on {dashboard_id!r}; panels are: {known}"
        )

    next_query = query if query is not None else current.query
    next_spec = spec_raw if spec_raw is not None else current.spec.to_dict()

    check = check_panel(next_query, next_spec)
    if not check["ok"]:
        return check

    _write_panel(
        Panel(
            dashboard_id=dashboard_id,
            id=panel_id,
            title=title if title is not None else current.title,
            query=next_query,
            spec=parse_spec(check["spec"]),
            position=position if position is not None else current.position,
            width=max(3, min(12, width)) if width is not None else current.width,
            height=max(1, min(3, height)) if height is not None else current.height,
        )
    )
    check["panel_id"] = panel_id
    return check


def delete_panel(dashboard_id: str, panel_id: str) -> None:
    dashboard = get_dashboard(dashboard_id)
    panel = next((p for p in dashboard.panels if p.id == panel_id), None)
    if panel is None:
        known = ", ".join(p.id for p in dashboard.panels) or "none"
        raise DashboardError(
            f"no panel {panel_id!r} on {dashboard_id!r}; panels are: {known}"
        )
    _write_panel(panel, deleted=True)
