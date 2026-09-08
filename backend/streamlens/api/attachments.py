"""Charts the user pasted into a message, read for the model.

Copying a chart off the canvas and pasting it into the chat is the same
gesture as pasting code into a coding agent, and it has to mean the same
thing: the chart arrives as content, not as an address the model is invited
to go and look up. So the browser sends back the paths it pasted
(`streamlens/links.py` reads them) and they are resolved here into the spec,
the SQL and the numbers the chart is drawing right now.

Resolved here rather than by the model because the two costs are not
comparable. A panel query is a warehouse round trip; a tool call the model
has to decide to make is a model round trip, an order of magnitude slower and
one it can skip. "Based on this chart, what would you make" should be
answerable on the first call.

The same stores the tools use, so what the user attached and what the agent
would have fetched cannot disagree. Nothing here writes.
"""

from __future__ import annotations

import json
import logging
from textwrap import indent
from typing import Any, Callable, Sequence

from streamlens.links import Ref, read_link

log = logging.getLogger(__name__)

# The marker that makes this block recognisable later. The block is content,
# so it is in the session forever, and a transcript being replayed has to be
# able to tell it apart from something a person typed.
MARK = "[attached]"

# One paste is the case; a handful is a comparison. Past that it is a way to
# fill the context window with sample rows, and the agent can read what it
# needs itself.
LIMIT = 4

# Matches read_panels, so an attached chart and one the agent went and read
# show the same amount of the same data.
SAMPLE = 12

PREAMBLE = (
    f"{MARK} The user copied the following off the canvas and pasted it into "
    'this message. It is what "this chart", "this one" and "it" refer to on '
    "this turn, ahead of whichever tab happens to be open. The figures were "
    "read from the warehouse just now, so quote them rather than replaying "
    "the query. If the user asks for a change to what is attached, change "
    "that panel in place using the ids given with it — do not build a second "
    "copy of it somewhere else."
)


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _numbers(read: Callable[[], dict[str, Any]]) -> list[str]:
    """What the chart is drawing, or why it is not drawing anything.

    A panel whose query has stopped running is worth attaching anyway: the
    user is pointing at a broken chart and the answer is about the breakage.
    """
    from streamlens.dashboards.glance import glance

    try:
        result = read()
    except Exception as exc:  # a dead query, not a dead turn
        return [f"its query does not run right now: {' '.join(str(exc).split())}"]

    rows = result["rows"]
    columns = result["columns"]
    shown = rows[:SAMPLE]
    return [
        f"{len(rows)} rows; columns: {', '.join(columns)}",
        f"glance: {_dumps(glance(columns, result['types'], rows))}",
        (
            "rows: "
            if len(shown) == len(rows)
            else f"first {len(shown)} of {len(rows)} rows: "
        )
        + _dumps(shown),
    ]


def _dashboard_chart(ref: Ref) -> list[str]:
    from streamlens.dashboards import store

    dashboard = store.get_dashboard(ref.owner_id)
    panel = next((p for p in dashboard.panels if p.id == ref.panel_id), None)
    if panel is None:
        return [
            f"a chart that is no longer on dashboard `{dashboard.id}` "
            f"(panel `{ref.panel_id}`). Say so rather than guessing which "
            "one was meant."
        ]

    return [
        f"CHART {_dumps(panel.title)}",
        f"panel `{panel.id}` on dashboard `{dashboard.id}` "
        f"({_dumps(dashboard.title)})",
        f"spec: {_dumps(panel.spec.to_dict())}",
        "query:",
        indent(panel.query.strip(), "  "),
        *_numbers(lambda: store.run_panel_query(panel.query, limit=200)),
    ]


def _dashboard(ref: Ref) -> list[str]:
    from streamlens.dashboards import store

    dashboard = store.get_dashboard(ref.owner_id)
    charts = "; ".join(
        f"`{p.id}` {p.spec.type} {_dumps(p.title)}" for p in dashboard.panels
    )
    return [
        f"DASHBOARD {_dumps(dashboard.title)} `{dashboard.id}`",
        f"{len(dashboard.panels)} panels: {charts or 'none yet'}",
        "specs only here — read_panels gives you what they draw.",
    ]


def _proposal_chart(ref: Ref) -> list[str]:
    from streamlens.proposals import store

    proposal = store.get_proposal(ref.owner_id)
    panel = next((p for p in proposal.panels if p.id == ref.panel_id), None)
    if panel is None:
        return [
            f"a chart that is no longer on proposal `{proposal.id}` "
            f"(panel `{ref.panel_id}`)."
        ]

    return [
        f"CHART {_dumps(panel.title)}",
        f"panel `{panel.id}` on proposal `{proposal.id}` "
        f"({_dumps(proposal.doc.title)})",
        f"spec: {_dumps(panel.spec.to_dict())}",
        "query:",
        indent(panel.query.strip(), "  "),
        *_numbers(
            lambda: store.run_proposal_panel(proposal.id, panel.id),
        ),
    ]


def _proposal(ref: Ref) -> list[str]:
    from streamlens.proposals import store

    proposal = store.get_proposal(ref.owner_id)
    doc = proposal.doc
    charts = "; ".join(f"`{p.id}` {_dumps(p.title)}" for p in proposal.panels)
    return [
        f"PROPOSAL {_dumps(doc.title)} `{proposal.id}` ({doc.genre})",
        f"hook: {doc.hook}" if doc.hook else "no hook yet",
        f"{len(proposal.panels)} charts: {charts or 'none yet'}",
        "read_proposal gives you the full one-sheet and what its charts draw.",
    ]


def _block(ref: Ref) -> str:
    """One attachment, described. Never raises: a bad reference is a line."""
    try:
        if ref.kind == "dashboard":
            lines = _dashboard_chart(ref) if ref.panel_id else _dashboard(ref)
        else:
            lines = _proposal_chart(ref) if ref.panel_id else _proposal(ref)
    except Exception as exc:
        log.warning("could not resolve attachment %s: %s", ref.link, exc)
        lines = [
            f"something the user pointed at that cannot be read: {ref.link} "
            f"({' '.join(str(exc).split())})"
        ]
    return "\n".join(lines)


def describe(links: Sequence[str]) -> str:
    """The turn's attachments as one block of context, or "" if there are none.

    Order and duplicates come from the user's paste, so both are tidied: the
    same chart pasted twice is one attachment, and the block is only built
    when something in the list actually parses.
    """
    refs: list[Ref] = []
    for href in links:
        try:
            ref = read_link(href)
        except Exception:  # whatever was on the clipboard is not a path
            continue
        if ref is not None and ref not in refs:
            refs.append(ref)
        if len(refs) == LIMIT:
            break

    if not refs:
        return ""
    return "\n\n".join([PREAMBLE, *(_block(ref) for ref in refs)])
