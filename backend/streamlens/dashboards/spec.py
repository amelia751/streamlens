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
    """The columns a panel reads, one field per channel in the registry.

    Every field is optional because which ones matter is a property of the
    chart type, not of the spec. A panel saved before a channel existed
    simply has it unset, which is why nothing here is required.
    """

    type: str
    x: str | None = None
    y: list[str] = field(default_factory=list)
    series: str | None = None
    value: str | None = None
    path: list[str] = field(default_factory=list)
    source: str | None = None
    target: str | None = None
    stacked: bool = False
    format: str = "number"

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "x": self.x,
            "y": self.y,
            "series": self.series,
            "value": self.value,
            "path": self.path,
            "source": self.source,
            "target": self.target,
            "stacked": self.stacked,
            "format": self.format,
        }


def parse_spec(raw: dict) -> PanelSpec:
    """Turn the model's JSON into a spec, or explain what is wrong with it."""
    if not isinstance(raw, dict):
        raise SpecError("spec must be a JSON object")

    raw_type = str(raw.get("type", "")).strip()
    kind = chart(raw_type)
    if kind is None:
        raise SpecError(f"unknown chart type {raw_type!r}; use one of {type_list()}")
    chart_type = kind.name

    def columns(key: str) -> list[str]:
        given = raw.get(key) or []
        if isinstance(given, str):
            given = [given]
        if not isinstance(given, list) or any(not isinstance(c, str) for c in given):
            raise SpecError(f"{key!r} must be a column name or a list of column names")
        return [str(c) for c in given]

    y_raw = columns("y")
    path_raw = columns("path")

    value_format = str(raw.get("format", "number")).lower()
    if value_format not in VALUE_FORMATS:
        raise SpecError(
            f"unknown format {value_format!r}; use one of {', '.join(VALUE_FORMATS)}"
        )

    def one(key: str) -> str | None:
        given = raw.get(key)
        return str(given) if given else None

    return PanelSpec(
        type=chart_type,
        x=one("x"),
        y=y_raw,
        series=one("series"),
        value=one("value"),
        path=path_raw,
        source=one("source"),
        target=one("target"),
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
                # "needs its" rather than "needs a/an", which would have to
                # know that the article before 'x' is not the one before 'y'.
                wants = "at least one" if channel.many else "its"
                problems.append(
                    f"a {kind.name} panel needs {wants} '{channel.name}' column "
                    f"— {channel.describe}"
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
