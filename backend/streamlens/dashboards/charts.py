"""The chart vocabulary: every type the curator can ask for, in one place.

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


@dataclass(frozen=True)
class Chart:
    """One chart type: what it is for, and what it needs to be drawn."""

    name: str
    when: str
    channels: tuple[Channel, ...] = ()

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


# The channels themselves are shared, so two types asking for "an x column"
# are asking for exactly the same thing.
_X = Channel("x", "the horizontal axis, usually a date or a category")
_MEASURES = Channel("y", "the measure columns to plot", many=True)
_MEASURE = Channel("y", "the single measure to plot")
_SERIES = Channel(
    "series",
    'a dimension to split one measure across, e.g. "channel"',
    required=False,
)


CHARTS: tuple[Chart, ...] = (
    Chart("line", "a measure over time.", (_X, _MEASURES, _SERIES)),
    Chart(
        "area",
        "a measure over time when the band matters more than the exact "
        "level; set stacked when the parts sum to a meaningful whole.",
        (_X, _MEASURES, _SERIES),
    ),
    Chart("bar", "comparing categories, or counts per period.", (_X, _MEASURES, _SERIES)),
    Chart("scatter", "the relationship between two measures.", (_X, _MEASURES, _SERIES)),
    Chart("pie", "a share of a whole, and only at about six slices or fewer.", (_X, _MEASURE)),
    Chart("stat", "a single headline number.", (_MEASURE,)),
    Chart("table", "when the rows are the point — names, ids, long tails.", ()),
)


CHART_TYPES: tuple[str, ...] = tuple(c.name for c in CHARTS)

_BY_NAME = {c.name: c for c in CHARTS}


def chart(name: str) -> Chart | None:
    return _BY_NAME.get(name)


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
        elif channel.many:
            bits.append(f"{channel.name} (one or more)")
        else:
            bits.append(f"{channel.name} (exactly one)")
    return f"Takes {', '.join(bits)}."


def guide(indent: str = "") -> str:
    """The vocabulary as the model should read it.

    Written into both the tool documentation and the agent instruction, so
    the two can never describe different sets of charts. `indent` lets it
    sit inside an indented docstring section without breaking it.
    """
    return "\n".join(f"{indent}- `{c.name}` — {c.when} {_takes(c)}" for c in CHARTS)
