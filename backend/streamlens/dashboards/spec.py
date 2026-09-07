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

from streamlens.dashboards.charts import CHART_TYPES, chart, type_list

VALUE_FORMATS = ("number", "compact", "percent", "bytes", "duration", "currency")

__all__ = ["CHART_TYPES", "PanelSpec", "SpecError", "VALUE_FORMATS", "parse_spec", "validate_spec"]


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
        raise SpecError(f"unknown chart type {chart_type!r}; use one of {type_list()}")

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


def _columns_for(spec: PanelSpec, channel: str) -> list[str]:
    """The columns the spec put in one channel, always as a list."""
    value = getattr(spec, channel, None)
    if value is None or value == "":
        return []
    return list(value) if isinstance(value, list) else [str(value)]


def validate_spec(spec: PanelSpec, columns: list[str]) -> list[str]:
    """Check the spec against the columns the query returned.

    Every rule comes from the chart registry rather than from lists kept
    here, so a type cannot be described to the model in terms that
    validation would then reject.

    Returns a list of problems, each phrased so the model can fix it without
    another round trip. An empty list means the panel is drawable.
    """
    kind = chart(spec.type)
    if kind is None:
        return [f"unknown chart type {spec.type!r}; use one of {type_list()}"]

    problems: list[str] = []
    available = ", ".join(columns) or "none"

    for channel in kind.channels:
        chosen = _columns_for(spec, channel.name)

        if not chosen:
            if channel.required:
                problems.append(
                    f"a {kind.name} panel needs {'at least one' if channel.many else 'an'} "
                    f"'{channel.name}' column — {channel.describe}"
                )
            continue

        if not channel.many and len(chosen) > 1:
            problems.append(
                f"a {kind.name} panel takes exactly one '{channel.name}' column, "
                f"got {len(chosen)}"
            )

        for column in chosen:
            if column not in columns:
                problems.append(
                    f"{channel.name} column {column!r} is not in the query result; "
                    f"the query returns: {available}"
                )

    # Splitting by a dimension and plotting several measures are two ways to
    # get multiple series, and asking for both leaves the split ambiguous.
    if kind.splits and spec.series and len(spec.y) > 1:
        problems.append(
            "use either 'series' to split one measure into lines, or "
            "several 'y' columns — not both"
        )

    return problems
