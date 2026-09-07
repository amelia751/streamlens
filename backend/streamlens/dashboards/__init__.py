"""Agent-authored dashboards: the spec, its validation, and its storage."""

from streamlens.dashboards.spec import PanelSpec, SpecError, parse_spec, validate_spec
from streamlens.dashboards.store import (
    Dashboard,
    DashboardError,
    Panel,
    add_panel,
    check_panel,
    create_dashboard,
    delete_dashboard,
    delete_panel,
    ensure_schema,
    get_dashboard,
    list_dashboards,
    run_panel_query,
    update_dashboard,
    update_panel,
)

__all__ = [
    "Dashboard",
    "DashboardError",
    "Panel",
    "PanelSpec",
    "SpecError",
    "add_panel",
    "check_panel",
    "create_dashboard",
    "delete_dashboard",
    "delete_panel",
    "ensure_schema",
    "get_dashboard",
    "list_dashboards",
    "parse_spec",
    "run_panel_query",
    "update_dashboard",
    "update_panel",
    "validate_spec",
]
