"""The chart vocabulary: every type the analyst can ask for, in one place.

This exists because the vocabulary used to be written down five times — the
tuple that gates it, the tuple listing which types need an x column, the
prose in the `add_panel` docstring, the prose in the agent's instruction,
and the union in the web client. Only two of those were enforced. The prose
is the part the model actually reads, so a type could be perfectly
supported by the backend and still be invisible to the agent, or described
in terms that no longer matched what validation would accept.

So a chart type is declared once, here, as what it is for and what columns
it needs. Validation walks this. The tool documentation and the agent's
guidance are generated from it. Adding a type is one entry plus one branch
in the renderer, and nothing can drift out of step with it.

What is deliberately *not* here is anything about how a chart looks. The
model picks meaning; the renderer owns geometry, colour and motion.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Channel:
    """A slot that a chart type reads one or more columns from."""

    name: str
    describe: str
    required: bool = True
    many: bool = False
    exactly: int | None = None


@dataclass(frozen=True)
class Chart:
    """One chart type: what it is for, and what it needs to be drawn.

    `shape` is the shape of the *result* this type answers to — one number,
    a flow, a hierarchy. It exists because a flat alphabet of 26 types is
    read top-down and answered with whichever entry fits first, which is
    how every dashboard ends up made of bars. Grouped by shape, the list
    becomes a decision table: look at what the query returned, then read
    only that group.
    """

    name: str
    when: str
    channels: tuple[Channel, ...] = ()
    shape: str = "other"

    def channel(self, name: str) -> Channel | None:
        return next((c for c in self.channels if c.name == name), None)

    @property
    def splits(self) -> bool:
        """Whether this type can split one measure across a dimension.

        Only these types can be asked for both a `series` and several `y`
        columns, which is the one combination that is always a mistake.
        """
        y = self.channel("y")
        return self.channel("series") is not None and y is not None and y.many


# Channels are shared between types, so two charts asking for "an x column"
# are asking for exactly the same thing. Where a type reads a slot
# differently — a heatmap's y is a category, not a measure — it gets its own
# Channel on the same field, because the description is what the model is
# told when it gets the column wrong.
_X = Channel("x", "the horizontal axis, usually a date or a category")
_MEASURES = Channel("y", "the measure columns to plot", many=True)
_MEASURE = Channel("y", "the single measure to plot")
_SERIES = Channel(
    "series",
    'a dimension to split one measure across, e.g. "channel"',
    required=False,
)

_CATEGORY = Channel("x", "the category each mark stands for")
_ROW = Channel("y", "the vertical axis, a category rather than a measure")
_DATE = Channel("x", "a date column, one row per day")
_OBSERVATIONS = Channel("y", "the measure to take the distribution of, one row per observation")
_VALUE = Channel("value", "the single measure the mark is sized or shaded by")
_PATH = Channel("path", "the columns forming the hierarchy, outermost first", many=True)
_SOURCE = Channel("source", "the column the flow leaves")
_TARGET = Channel("target", "the column the flow arrives at")
_PLACE = Channel("x", "a country name or two-letter country code")
_ENTITY = Channel("x", "the thing being compared, one row each")
_THEME = Channel(
    "series",
    "the stream each band belongs to, e.g. a genre or a category",
)
_VALUE_OPTIONAL = Channel(
    "value",
    "an optional measure; without it every leaf counts as one",
    required=False,
)
_OHLC = Channel(
    "y",
    "four columns in order: open, close, low, high",
    many=True,
    exactly=4,
)


CHARTS: tuple[Chart, ...] = (
    Chart("line", "a measure over time.", (_X, _MEASURES, _SERIES), "A measure over time"),
    Chart(
        "area",
        "a measure over time when the band matters more than the exact "
        "level; set stacked when the parts sum to a meaningful whole.",
        (_X, _MEASURES, _SERIES),
        "A measure over time",
    ),
    Chart("bar", "comparing categories, or counts per period.", (_X, _MEASURES, _SERIES), "Categories compared"),
    Chart("scatter", "the relationship between two measures.", (_X, _MEASURES, _SERIES), "Two measures against each other"),
    Chart("pie", "a share of a whole, and only at about six slices or fewer.", (_X, _MEASURE), "Parts of one whole"),
    Chart(
        "funnel",
        "steps of a process that only ever loses people, largest first.",
        (_CATEGORY, _MEASURE),
        "Parts of one whole",
    ),
    Chart(
        "heatmap",
        "one measure across two categories at once, e.g. weekday against "
        "hour, or country against week.",
        (_X, _ROW, _VALUE),
        "Two dimensions at once",
    ),
    Chart(
        "calendar",
        "daily activity over a year or more, where the weekly and seasonal "
        "rhythm is the point.",
        (_DATE, _VALUE),
        "A measure over time",
    ),
    Chart(
        "treemap",
        "how a total breaks down, when the parts are too many or too uneven "
        "for a pie.",
        (_PATH, _VALUE),
        "A hierarchy",
    ),
    Chart(
        "sunburst",
        "the same breakdown as a treemap when the nesting itself is worth "
        "seeing; keep it to two or three levels.",
        (_PATH, _VALUE),
        "A hierarchy",
    ),
    Chart(
        "sankey",
        "flow between two sets of things, e.g. which page a session came "
        "from and where it went.",
        (_SOURCE, _TARGET, _VALUE),
        "Flow between things",
    ),
    Chart(
        "boxplot",
        "how a measure is distributed within each category, not just its "
        "average. Give it the raw rows; the spread is worked out for you.",
        (_CATEGORY, _OBSERVATIONS),
        "A distribution, not an average",
    ),
    Chart(
        "map",
        "a measure by country, shaded on a world map.",
        (_PLACE, _VALUE),
        "Geography",
    ),
    Chart(
        "radar",
        "several measures of the same things, compared at once — each "
        "axis is its own scale, so mix units freely.",
        (_ENTITY, _MEASURES),
        "Several measures per thing",
    ),
    Chart(
        "gauge",
        "a single number against a scale, when how full the jar is is the point.",
        (_MEASURE,),
        "One number",
    ),
    Chart(
        "graph",
        "a network of things that connect to each other, including cycles.",
        (_SOURCE, _TARGET, _VALUE),
        "Flow between things",
    ),
    Chart(
        "tree",
        "a hierarchy when the nesting is the point and the sizes are not.",
        (_PATH, _VALUE_OPTIONAL),
        "A hierarchy",
    ),
    Chart(
        "themeRiver",
        "how a mix changes over time, when the shifting share is the point.",
        (_X, _MEASURE, _THEME),
        "A measure over time",
    ),
    Chart(
        "chord",
        "how a set of things trade with each other, drawn as ribbons "
        "around a circle.",
        (_SOURCE, _TARGET, _VALUE),
        "Flow between things",
    ),
    Chart(
        "parallel",
        "several measures of the same things, as axes in a row, so you "
        "can read each one's profile.",
        (_ENTITY, _MEASURES),
        "Several measures per thing",
    ),
    Chart(
        "pictorialBar",
        "comparing categories when a repeated mark reads more clearly "
        "than a filled bar.",
        (_X, _MEASURE),
        "Categories compared",
    ),
    Chart(
        "effectScatter",
        "the relationship between two measures, when a few points should "
        "pulse so the eye lands on them.",
        (_X, _MEASURES, _SERIES),
        "Two measures against each other",
    ),
    Chart(
        "candlestick",
        "the open, close, high and low of a measure over time.",
        (_X, _OHLC),
        "A measure over time",
    ),
    Chart(
        "lines",
        "flow between countries, drawn as arcs on the world map.",
        (_SOURCE, _TARGET, _VALUE),
        "Geography",
    ),
    Chart("stat", "a single headline number.", (_MEASURE,), "One number"),
    Chart("table", "when the rows are the point — names, ids, long tails.", (), "The rows themselves"),
)


CHART_TYPES: tuple[str, ...] = tuple(c.name for c in CHARTS)

_BY_NAME = {c.name: c for c in CHARTS}
_BY_LOWER = {c.name.lower(): c for c in CHARTS}


def chart(name: str) -> Chart | None:
    return _BY_NAME.get(name) or _BY_LOWER.get(name.lower())


def type_list() -> str:
    """The bare list, for error messages."""
    return ", ".join(CHART_TYPES)


def _takes(spec: Chart) -> str:
    if not spec.channels:
        return "Takes no columns; it draws whatever the query returns."
    bits = []
    for channel in spec.channels:
        if not channel.required:
            bits.append(f"optionally {channel.name}")
        elif channel.exactly:
            bits.append(f"{channel.name} (exactly {channel.exactly})")
        elif channel.many:
            bits.append(f"{channel.name} (one or more)")
        else:
            bits.append(f"{channel.name} (exactly one)")
    return f"Takes {', '.join(bits)}."


# The order the shapes are offered in. Deliberately not the order the types
# are declared in: `line`, `area` and `bar` are declared first because they
# are the oldest, and a model reading a flat list top-down answers with the
# first thing that fits — which is why every dashboard came out as bars.
_SHAPE_ORDER: tuple[str, ...] = (
    "One number",
    "A measure over time",
    "Categories compared",
    "Parts of one whole",
    "Two measures against each other",
    "Two dimensions at once",
    "A distribution, not an average",
    "A hierarchy",
    "Flow between things",
    "Geography",
    "Several measures per thing",
    "The rows themselves",
)


def guide(indent: str = "") -> str:
    """The vocabulary as the model should read it: grouped by data shape.

    Written into both the tool documentation and the agent instruction, so
    the two can never describe different sets of charts. `indent` lets it
    sit inside an indented docstring section without breaking it.

    Grouped rather than listed, because the choice a model has to make is
    "what shape is this result?" and only then "which type draws that
    shape". A flat list invites it to skip the first question.
    """
    by_shape: dict[str, list[Chart]] = {}
    for kind in CHARTS:
        by_shape.setdefault(kind.shape, []).append(kind)

    lines: list[str] = []
    for shape in _SHAPE_ORDER:
        kinds = by_shape.get(shape)
        if not kinds:
            continue
        lines.append(f"{indent}{shape}:")
        for kind in kinds:
            lines.append(f"{indent}  - `{kind.name}` — {kind.when} {_takes(kind)}")
    return "\n".join(lines)
