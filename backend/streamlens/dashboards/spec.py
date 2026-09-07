"""The panel spec: what a chart means, not how it is drawn.

The model writes intent — "a line of `views` over `day`, split by `channel`"
— and the renderer decides scales, ticks, padding, and colour. Asking a model
for a rendering library's own JSON instead is the standard way to get specs
that are valid but ugly, or verbose and broken; the geometry is exactly the
part it should not be improvising.

Everything here is validated against the columns the query actually returns,
so a panel cannot be saved referencing a column that does not exist.
"""

from __future__ import annotations

from dataclasses import dataclass, field

CHART_TYPES = ("line", "bar", "area", "scatter", "pie", "table", "stat")

VALUE_FORMATS = ("number", "compact", "percent", "bytes", "duration", "currency")


class SpecError(ValueError):
    """Raised with a message written to be read by the model."""


@dataclass
class PanelSpec:
    type: str
    x: str | None = None
    y: list[str] = field(default_factory=list)
    series: str | None = None
    stacked: bool = False
    format: str = "number"

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "x": self.x,
            "y": self.y,
            "series": self.series,
            "stacked": self.stacked,
            "format": self.format,
        }


def parse_spec(raw: dict) -> PanelSpec:
    """Turn the model's JSON into a spec, or explain what is wrong with it."""
    if not isinstance(raw, dict):
        raise SpecError("spec must be a JSON object")

    chart_type = str(raw.get("type", "")).strip().lower()
    if chart_type not in CHART_TYPES:
        raise SpecError(
            f"unknown chart type {chart_type!r}; use one of {', '.join(CHART_TYPES)}"
        )

    y_raw = raw.get("y") or []
    if isinstance(y_raw, str):
        y_raw = [y_raw]
    if not isinstance(y_raw, list) or any(not isinstance(c, str) for c in y_raw):
        raise SpecError("'y' must be a column name or a list of column names")

    value_format = str(raw.get("format", "number")).lower()
    if value_format not in VALUE_FORMATS:
        raise SpecError(
            f"unknown format {value_format!r}; use one of {', '.join(VALUE_FORMATS)}"
        )

    x = raw.get("x")
    series = raw.get("series")
    return PanelSpec(
        type=chart_type,
        x=str(x) if x else None,
        y=[str(c) for c in y_raw],
        series=str(series) if series else None,
        stacked=bool(raw.get("stacked", False)),
        format=value_format,
    )


# What each chart type needs before it can be drawn.
_REQUIRES_X = ("line", "bar", "area", "scatter", "pie")
_SINGLE_Y = ("pie", "stat")


def validate_spec(spec: PanelSpec, columns: list[str]) -> list[str]:
    """Check the spec against the columns the query returned.

    Returns a list of problems, each phrased so the model can fix it without
    another round trip. An empty list means the panel is drawable.
    """
    problems: list[str] = []
    available = ", ".join(columns) or "none"

    def known(channel: str, column: str) -> None:
        if column not in columns:
            problems.append(
                f"{channel} column {column!r} is not in the query result; "
                f"the query returns: {available}"
            )

    if spec.type in _REQUIRES_X:
        if not spec.x:
            problems.append(f"a {spec.type} panel needs an 'x' column")
        else:
            known("x", spec.x)

    if spec.type == "table":
        # A table draws whatever the query returns, so it needs no channels.
        return problems

    if not spec.y:
        problems.append(f"a {spec.type} panel needs at least one 'y' column")
    for column in spec.y:
        known("y", column)

    if spec.type in _SINGLE_Y and len(spec.y) > 1:
        problems.append(
            f"a {spec.type} panel takes exactly one 'y' column, got {len(spec.y)}"
        )

    if spec.series:
        known("series", spec.series)
        if len(spec.y) > 1:
            problems.append(
                "use either 'series' to split one measure into lines, or "
                "several 'y' columns — not both"
            )

    return problems
