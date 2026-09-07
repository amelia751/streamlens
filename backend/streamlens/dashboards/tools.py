"""The dashboard tool surface, written to be called by a model.

Every tool takes flat scalar arguments rather than a nested spec object.
Function calling is markedly more reliable that way: a model that must emit
`{"spec": {"type": "line", "y": ["uploads"]}}` gets the nesting wrong far more
often than one filling in `chart_type="line", y=["uploads"]`.

Tools never raise for ordinary mistakes. A bad column or an unknown panel
comes back as `{"ok": false, "problems": [...]}` with the real column list
attached, so the model can correct itself on the next turn instead of seeing
a stack trace.
"""

from __future__ import annotations

from typing import Any

from streamlens.dashboards import store
from streamlens.dashboards.spec import CHART_TYPES, SpecError

CHART_TYPE_HELP = ", ".join(CHART_TYPES)


def _spec(
    chart_type: str,
    x: str,
    y: list[str],
    series: str,
    stacked: bool,
    value_format: str,
) -> dict:
    return {
        "type": chart_type,
        "x": x or None,
        "y": y or [],
        "series": series or None,
        "stacked": stacked,
        "format": value_format or "number",
    }


def _failed(message: str) -> dict[str, Any]:
    return {"ok": False, "problems": [message]}


def preview_query(query: str) -> dict[str, Any]:
    """Run a SELECT and see what it returns, without saving anything.

    Call this before adding a panel when unsure of the column names or the
    shape of the result. The query runs read-only.

    Args:
        query: a single SELECT (or WITH ... SELECT) statement.

    Returns:
        The column names, their ClickHouse types, and up to five sample rows.
    """
    try:
        result = store.run_panel_query(query, limit=50)
    except store.DashboardError as exc:
        return _failed(str(exc))
    return {
        "ok": True,
        "columns": result["columns"],
        "types": result["types"],
        "sample_rows": result["rows"][:5],
        "row_count": len(result["rows"]),
    }


def list_dashboards() -> dict[str, Any]:
    """List every dashboard, with its id, title and panel count."""
    return {"ok": True, "dashboards": store.list_dashboards()}


def get_dashboard(dashboard_id: str) -> dict[str, Any]:
    """Read one dashboard and every panel on it.

    Args:
        dashboard_id: the dashboard's id, as returned by list_dashboards.
    """
    try:
        return {"ok": True, "dashboard": store.get_dashboard(dashboard_id).to_dict()}
    except store.DashboardError as exc:
        return _failed(str(exc))


def create_dashboard(title: str, description: str = "") -> dict[str, Any]:
    """Create an empty dashboard and return its id.

    Add panels to it with add_panel.

    Args:
        title: a short human title, e.g. "YouTube promo performance".
        description: one sentence on what the dashboard answers.
    """
    try:
        dashboard_id = store.create_dashboard(title, description)
    except store.DashboardError as exc:
        return _failed(str(exc))
    return {"ok": True, "dashboard_id": dashboard_id}


def update_dashboard(
    dashboard_id: str, title: str = "", description: str = ""
) -> dict[str, Any]:
    """Rename a dashboard or change its description.

    Args:
        dashboard_id: the dashboard to change.
        title: new title, or "" to leave unchanged.
        description: new description, or "" to leave unchanged.
    """
    try:
        store.update_dashboard(
            dashboard_id,
            title=title or None,
            description=description or None,
        )
    except store.DashboardError as exc:
        return _failed(str(exc))
    return {"ok": True, "dashboard_id": dashboard_id}


def delete_dashboard(dashboard_id: str) -> dict[str, Any]:
    """Delete a dashboard and all of its panels.

    Args:
        dashboard_id: the dashboard to delete.
    """
    try:
        removed = store.delete_dashboard(dashboard_id)
    except store.DashboardError as exc:
        return _failed(str(exc))
    return {"ok": True, "deleted_panels": removed}


def add_panel(
    dashboard_id: str,
    title: str,
    query: str,
    chart_type: str,
    x: str = "",
    y: list[str] | None = None,
    series: str = "",
    stacked: bool = False,
    value_format: str = "number",
    width: int = 6,
    height: int = 1,
) -> dict[str, Any]:
    """Add a panel to a dashboard.

    The query is run before the panel is saved and the columns it returns are
    checked against x, y and series. If any of them is missing the panel is
    NOT saved and the problems are returned along with the real column list.

    Args:
        dashboard_id: the dashboard to add to.
        title: the panel's title.
        query: a single SELECT returning the columns named below. Keep it
            aggregated — a panel plots at most a few thousand points.
        chart_type: one of line, bar, area, scatter, pie, table, stat.
        x: the column on the horizontal axis, usually a date. Required for
            line, bar, area, scatter and pie. Leave "" for table and stat.
        y: the measure columns to plot. One for pie and stat.
        series: optional column to split one measure into several lines or
            bars, e.g. "channel". Do not combine with several y columns.
        stacked: stack the series instead of overlaying them.
        value_format: number, compact, percent, bytes, duration or currency.
        width: grid width out of 12. Use 12 for a full-width time series,
            6 for a half, 3 for a small stat.
        height: 1, 2 or 3 rows tall.
    """
    if chart_type not in CHART_TYPES:
        return _failed(f"unknown chart_type {chart_type!r}; use one of {CHART_TYPE_HELP}")
    try:
        return store.add_panel(
            dashboard_id,
            title,
            query,
            _spec(chart_type, x, y or [], series, stacked, value_format),
            width=width,
            height=height,
        )
    except (store.DashboardError, SpecError) as exc:
        return _failed(str(exc))


def update_panel(
    dashboard_id: str,
    panel_id: str,
    title: str = "",
    query: str = "",
    chart_type: str = "",
    x: str = "",
    y: list[str] | None = None,
    series: str = "",
    stacked: bool = False,
    value_format: str = "",
    width: int = 0,
    height: int = 0,
    position: int = -1,
) -> dict[str, Any]:
    """Change an existing panel.

    Only the arguments you supply are changed; empty strings, 0 and -1 mean
    "leave as is". To change the chart type or any of its columns, pass
    chart_type together with the columns it needs — they are replaced as a
    set, not merged.

    Args:
        dashboard_id: the dashboard the panel is on.
        panel_id: the panel to change, as returned by get_dashboard.
        title: new title, or "".
        query: new SELECT, or "".
        chart_type: new chart type, or "" to keep the current one.
        x: horizontal axis column, used when chart_type is given.
        y: measure columns, used when chart_type is given.
        series: split column, used when chart_type is given.
        stacked: stack the series, used when chart_type is given.
        value_format: number, compact, percent, bytes, duration or currency.
        width: new grid width out of 12, or 0.
        height: new height in rows, or 0.
        position: new index in the grid, or -1.
    """
    spec_raw = None
    if chart_type:
        if chart_type not in CHART_TYPES:
            return _failed(
                f"unknown chart_type {chart_type!r}; use one of {CHART_TYPE_HELP}"
            )
        spec_raw = _spec(
            chart_type, x, y or [], series, stacked, value_format or "number"
        )

    try:
        return store.update_panel(
            dashboard_id,
            panel_id,
            title=title or None,
            query=query or None,
            spec_raw=spec_raw,
            width=width or None,
            height=height or None,
            position=position if position >= 0 else None,
        )
    except (store.DashboardError, SpecError) as exc:
        return _failed(str(exc))


def delete_panel(dashboard_id: str, panel_id: str) -> dict[str, Any]:
    """Remove one panel from a dashboard.

    Args:
        dashboard_id: the dashboard the panel is on.
        panel_id: the panel to remove.
    """
    try:
        store.delete_panel(dashboard_id, panel_id)
    except store.DashboardError as exc:
        return _failed(str(exc))
    return {"ok": True, "deleted": panel_id}


# The full surface, in the order a model would normally reach for them.
DASHBOARD_TOOLS = [
    preview_query,
    list_dashboards,
    get_dashboard,
    create_dashboard,
    update_dashboard,
    delete_dashboard,
    add_panel,
    update_panel,
    delete_panel,
]
