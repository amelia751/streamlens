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

from streamlens.dashboards import charts, store
from streamlens.dashboards.glance import glance
from streamlens.dashboards.spec import SpecError
from streamlens.services.clickhouse.catalog import read_schema_brief

CHART_TYPE_HELP = charts.type_list()


def _documents_charts(fn):
    """Fill the `{charts}` slot in a tool's docstring from the registry.

    The docstring is what the model reads before choosing a chart, so it is
    generated rather than written out. Listing the types by hand is how the
    documentation and the validation drifted apart in the first place.
    """
    doc = fn.__doc__ or ""
    for line in doc.splitlines():
        if "{charts}" in line:
            pad = line[: len(line) - len(line.lstrip())]
            doc = doc.replace(line, charts.guide(indent=pad))
            break
    fn.__doc__ = doc
    return fn


def _spec(
    chart_type: str,
    x: str,
    y: list[str],
    series: str,
    value: str,
    path: list[str],
    source: str,
    target: str,
    stacked: bool,
    value_format: str,
) -> dict:
    return {
        "type": chart_type,
        "x": x or None,
        "y": y or [],
        "series": series or None,
        "value": value or None,
        "path": path or [],
        "source": source or None,
        "target": target or None,
        "stacked": stacked,
        "format": value_format or "number",
    }


def _failed(message: str) -> dict[str, Any]:
    return {"ok": False, "problems": [message]}


def warehouse_overview() -> dict[str, Any]:
    """One look at the warehouse: today's date, databases, tables, columns.

    Call this once at the start of a session instead of list_databases and
    list_tables. Skip streamlens — that is the dashboard store, not a
    dataset — and do not walk system or empty databases after this.
    """
    try:
        return {"ok": True, **read_schema_brief()}
    except Exception as exc:
        return _failed(str(exc))


def preview_query(query: str) -> dict[str, Any]:
    """Run a SELECT and see what it returns, without saving anything.

    Prefer this over a second identical ClickHouse query when you are about
    to draw a chart. `glance` has first/last rows and min/max so you can
    caption from this result. Do not preview and then add the same SELECT
    — add_panel returns the same glance.

    Args:
        query: a single SELECT (or WITH ... SELECT) statement.
    """
    try:
        result = store.run_panel_query(query, limit=200)
    except store.DashboardError as exc:
        return _failed(str(exc))
    return {
        "ok": True,
        "columns": result["columns"],
        "types": result["types"],
        "sample_rows": result["rows"][:12],
        "row_count": len(result["rows"]),
        "glance": glance(result["columns"], result["types"], result["rows"]),
    }


def read_panels(dashboard_id: str, panel_id: str = "") -> dict[str, Any]:
    """Replay saved panel queries and return the numbers the charts draw.

    This is how you look at a dashboard that is already on the canvas.
    get_dashboard only returns specs; this runs each SELECT and gives you
    sample rows plus a glance (first/last, min/max). Call it before you
    caption or edit an existing chart.

    Args:
        dashboard_id: the dashboard to read.
        panel_id: one panel id, or "" to read every panel.
    """
    try:
        dashboard = store.get_dashboard(dashboard_id)
    except store.DashboardError as exc:
        return _failed(str(exc))

    wanted = [p for p in dashboard.panels if not panel_id or p.id == panel_id]
    if panel_id and not wanted:
        known = ", ".join(p.id for p in dashboard.panels) or "none"
        return _failed(f"no panel {panel_id!r} on {dashboard_id!r}; panels are: {known}")

    panels: list[dict[str, Any]] = []
    for panel in wanted:
        try:
            result = store.run_panel_query(panel.query, limit=200)
        except store.DashboardError as exc:
            panels.append(
                {
                    "id": panel.id,
                    "title": panel.title,
                    "ok": False,
                    "problems": [str(exc)],
                }
            )
            continue
        panels.append(
            {
                "id": panel.id,
                "title": panel.title,
                "ok": True,
                "spec": panel.spec.to_dict(),
                "columns": result["columns"],
                "types": result["types"],
                "sample_rows": result["rows"][:12],
                "row_count": len(result["rows"]),
                "glance": glance(result["columns"], result["types"], result["rows"]),
            }
        )
    return {
        "ok": True,
        "dashboard_id": dashboard.id,
        "title": dashboard.title,
        "panels": panels,
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


@_documents_charts
def add_panel(
    dashboard_id: str,
    title: str,
    query: str,
    chart_type: str,
    x: str = "",
    y: list[str] | None = None,
    series: str = "",
    value: str = "",
    path: list[str] | None = None,
    source: str = "",
    target: str = "",
    stacked: bool = False,
    value_format: str = "number",
    width: int = 6,
    height: int = 1,
) -> dict[str, Any]:
    """Add a panel to a dashboard.

    The query is run before the panel is saved and every column it names is
    checked against what the query actually returned. If any is missing the
    panel is NOT saved and the problems come back with the real column list.

    Args:
        dashboard_id: the dashboard to add to.
        title: the panel's title.
        query: a single SELECT returning the columns named below. Keep it
            aggregated — a panel plots at most a few thousand points. The
            exception is boxplot, which wants the raw rows.
        chart_type: which chart to draw. Each type below lists the columns it
            takes; leave the others as "".
            {charts}
        x: the main dimension — the horizontal axis on a cartesian chart, the
            category on a funnel, the country on a map.
        y: the measure columns to plot, or the second dimension on a heatmap.
        series: optional column to split one measure into several lines or
            bars, e.g. "channel". Do not combine with several y columns.
        value: the single measure for charts whose dimensions occupy other
            slots — heatmap, calendar, treemap, sunburst, sankey, map, graph,
            tree, chord and lines.
        path: the columns forming a hierarchy for treemap and sunburst,
            outermost first, e.g. ["genre", "title"].
        source: the column a sankey flow leaves.
        target: the column a sankey flow arrives at.
        stacked: stack the series instead of overlaying them.
        value_format: number, compact, percent, bytes, duration or currency.
        width: grid width out of 12. Use 12 for a full-width time series,
            6 for a half, 3 for a small stat.
        height: 1, 2 or 3 rows tall. Give a map, treemap, calendar, radar,
            graph, tree, themeRiver, chord, parallel or lines 2.
    """
    kind = charts.chart(chart_type)
    if kind is None:
        return _failed(f"unknown chart_type {chart_type!r}; use one of {CHART_TYPE_HELP}")
    try:
        return store.add_panel(
            dashboard_id,
            title,
            query,
            _spec(
                kind.name,
                x,
                y or [],
                series,
                value,
                path or [],
                source,
                target,
                stacked,
                value_format,
            ),
            width=width,
            height=height,
        )
    except (store.DashboardError, SpecError) as exc:
        return _failed(str(exc))


@_documents_charts
def update_panel(
    dashboard_id: str,
    panel_id: str,
    title: str = "",
    query: str = "",
    chart_type: str = "",
    x: str = "",
    y: list[str] | None = None,
    series: str = "",
    value: str = "",
    path: list[str] | None = None,
    source: str = "",
    target: str = "",
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
            {charts}
        x: main dimension column, used when chart_type is given.
        y: measure columns, used when chart_type is given.
        series: split column, used when chart_type is given.
        value: single measure column, used when chart_type is given.
        path: hierarchy columns, used when chart_type is given.
        source: flow origin column, used when chart_type is given.
        target: flow destination column, used when chart_type is given.
        stacked: stack the series, used when chart_type is given.
        value_format: number, compact, percent, bytes, duration or currency.
        width: new grid width out of 12, or 0.
        height: new height in rows, or 0.
        position: new index in the grid, or -1.
    """
    spec_raw = None
    if chart_type:
        kind = charts.chart(chart_type)
        if kind is None:
            return _failed(
                f"unknown chart_type {chart_type!r}; use one of {CHART_TYPE_HELP}"
            )
        spec_raw = _spec(
            kind.name,
            x,
            y or [],
            series,
            value,
            path or [],
            source,
            target,
            stacked,
            value_format or "number",
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
    warehouse_overview,
    preview_query,
    read_panels,
    list_dashboards,
    get_dashboard,
    create_dashboard,
    update_dashboard,
    delete_dashboard,
    add_panel,
    update_panel,
    delete_panel,
]
