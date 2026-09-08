"""The proposal tool surface, written to be called by a model.

Same two rules as `dashboards/tools.py`, and for the same reasons.

**Flat scalar arguments.** A model asked for
`{"archetypes": [{"name": ..., "note": ...}]}` gets the nesting wrong far
more often than one filling two parallel lists. So the cast arrives as
`archetype_names` and `archetype_notes`, checked here for equal length.

**Ordinary mistakes are not exceptions.** A field that is too long, a genre
outside the vocabulary, a panel that is not on the dashboard it was asked
for — all come back as `{"ok": false, "problems": [...]}` with enough
detail to fix it on the next turn. Nothing here shows the model a
traceback.

The chart arguments on `add_proposal_panel` are the ones `add_panel`
already documents, and the docstring is generated from the same registry,
so a proposal can never be offered a chart type a dashboard would reject.
"""

from __future__ import annotations

from typing import Any

from streamlens.dashboards import charts
from streamlens.dashboards.glance import glance
from streamlens.dashboards.spec import SpecError
from streamlens.dashboards.store import DashboardError, run_panel_query
from streamlens.dashboards.tools import _documents_charts, _spec
from streamlens.links import proposal_link
from streamlens.proposals import stills, store
from streamlens.proposals.spec import (
    ARCHETYPE_NOTE_MAX,
    LIMITS,
    MAX_ARCHETYPES,
    ProposalSpecError,
    genre_list,
)
from streamlens.services.gcp.gcp_services import ASPECT_RATIOS

CHART_TYPE_HELP = charts.type_list()
GENRE_HELP = genre_list()


def _failed(message: str) -> dict[str, Any]:
    return {"ok": False, "problems": [message]}


def _linked(result: dict[str, Any], proposal_id: str) -> dict[str, Any]:
    """Attach the canvas path for the proposal a write actually landed on.

    Only on success. A rejected field means nothing was saved, and a link to
    a proposal that was not written is worse than none.
    """
    if result.get("ok"):
        result["link"] = proposal_link(proposal_id)
    return result


def _documents_genres(fn):
    """Fill the `{genres}` slot in a docstring from the vocabulary.

    Generated rather than written out, for the reason the chart list is:
    the prose is what the model reads before it chooses, and a hand-copied
    list is how documentation and validation drift apart.
    """
    doc = fn.__doc__ or ""
    fn.__doc__ = doc.replace("{genres}", GENRE_HELP)
    return fn


def _archetypes(names: list[str], notes: list[str]) -> list[dict[str, str]]:
    if len(names) != len(notes):
        raise ProposalSpecError(
            f"archetype_names has {len(names)} entries and archetype_notes "
            f"has {len(notes)}; they are read pairwise, so they must match"
        )
    return [
        {"name": name, "note": note} for name, note in zip(names, notes)
    ]


def list_proposals() -> dict[str, Any]:
    """List every proposal, with its id, title, genre, chart count and link."""
    proposals = store.list_proposals()
    for proposal in proposals:
        proposal["link"] = proposal_link(str(proposal["id"]))
    return {"ok": True, "proposals": proposals}


def read_proposal(proposal_id: str) -> dict[str, Any]:
    """Read one proposal: its prose, its charts, and what those charts say.

    This is how you look at a proposal that is already on the canvas. Each
    panel comes back with a `glance` (first/last rows, min/max), so you can
    revise the market section against the actual numbers without querying
    again. A panel whose stored query no longer runs reports itself and the
    rest still come back.

    Args:
        proposal_id: the proposal to read, as returned by list_proposals.
    """
    try:
        proposal = store.get_proposal(proposal_id)
    except store.ProposalError as exc:
        return _failed(str(exc))

    panels: list[dict[str, Any]] = []
    for panel in proposal.panels:
        try:
            result = run_panel_query(panel.query, limit=200)
        except DashboardError as exc:
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
                "source_dashboard_id": panel.source_dashboard_id,
                "columns": result["columns"],
                "sample_rows": result["rows"][:12],
                "row_count": len(result["rows"]),
                "glance": glance(
                    result["columns"], result["types"], result["rows"]
                ),
            }
        )

    body = proposal.to_dict()
    body["panels"] = panels
    return {
        "ok": True,
        "proposal": body,
        "link": proposal_link(proposal.id),
    }


@_documents_genres
def create_proposal(
    title: str,
    genre: str,
    kicker: str,
    budget: str,
    hook: str,
    logline: str,
    connection: str,
    theme: str,
    market: str,
    archetype_names: list[str] | None = None,
    archetype_notes: list[str] | None = None,
) -> dict[str, Any]:
    """Write a theme proposal and return its id and its link.

    `link` is the path that opens the one-sheet on the canvas. Use it,
    verbatim, when you tell the user what you wrote.

    Every field lands in a fixed place on the one-sheet, so each has a hard
    character limit — stated per argument below, and counted on the way in.
    Write to the limit the first time. If something is over, the proposal is
    NOT saved and the overage comes back; cut it rather than resending.

    Write about the film, not to the filmmaker. "A thriller that only works
    after midnight" is the register. "Do not pitch a franchise", "Keep the
    runtime lean", and any other instruction aimed at the reader is not —
    the reader is the person pitching this, and they are holding a
    one-sheet, not your notes.

    Put charts on it afterwards with adopt_panel.

    Args:
        title: the working title. Short enough to sit over a still. {cap_title}
        genre: one of {genres}. It colours the whole page.
        kicker: the angle in three or four words, e.g. "Late-night window".
            {cap_kicker}
        budget: a band, e.g. "$18-28M". Not a single figure. {cap_budget}
        hook: one sentence, over the still. What the film is. {cap_hook}
        logline: one or two sentences. The pitch itself. {cap_logline}
        connection: what the warehouse finding has to do with the idea.
            {cap_connection}
        theme: what the film is *about* — the idea underneath the plot, in
            two short paragraphs separated by a blank line. A theme and a
            shape, not a synopsis and not a list of directives. {cap_theme}
        market: the argument the charts underneath are making. Every figure
            here must come from a panel on this proposal or a query you ran.
            {cap_market}
        archetype_names: the cast, as roles rather than names — "The
            uploader", "The regular". Read pairwise with archetype_notes.
        archetype_notes: one line each, same length and order as
            archetype_names. Two to {max_cast} of them, {cap_note} each.
    """
    try:
        archetypes = _archetypes(archetype_names or [], archetype_notes or [])
    except ProposalSpecError as exc:
        return _failed(str(exc))

    written = store.create_proposal(
        {
            "title": title,
            "genre": genre,
            "kicker": kicker,
            "budget": budget,
            "hook": hook,
            "logline": logline,
            "connection": connection,
            "theme": theme,
            "market": market,
            "archetypes": archetypes,
        }
    )
    return _linked(written, str(written.get("proposal_id") or ""))


def _documents_limits(doc: str) -> str:
    """Write each field's character cap into the docstring.

    Taken from `spec.LIMITS`, which is what validation reads — so the model
    is never told a budget the validator would reject. Stating the number
    matters: without it the model overshoots, gets an `ok: false`, and
    spends a code-sandbox call counting characters to recover.
    """
    for field, (cap, _) in LIMITS.items():
        doc = doc.replace(f"{{cap_{field}}}", f"At most {cap} characters.")
    doc = doc.replace("{cap_note}", f"at most {ARCHETYPE_NOTE_MAX} characters")
    return doc.replace("{max_cast}", str(MAX_ARCHETYPES))


create_proposal.__doc__ = _documents_limits(create_proposal.__doc__ or "")


@_documents_genres
def update_proposal(
    proposal_id: str,
    title: str = "",
    genre: str = "",
    kicker: str = "",
    budget: str = "",
    hook: str = "",
    logline: str = "",
    connection: str = "",
    theme: str = "",
    market: str = "",
    archetype_names: list[str] | None = None,
    archetype_notes: list[str] | None = None,
) -> dict[str, Any]:
    """Rewrite parts of a proposal. Empty strings mean "leave as is".

    The cast is replaced as a set: pass both lists, or neither.

    Args:
        proposal_id: the proposal to change.
        title: new title, or "".
        genre: one of {genres}, or "".
        kicker: new kicker, or "".
        budget: new band, or "".
        hook: new hook, or "".
        logline: new logline, or "".
        connection: new connection, or "".
        theme: new theme, or "".
        market: new market section, or "".
        archetype_names: the whole cast again, or omit to keep it.
        archetype_notes: same length and order as archetype_names.
    """
    changes: dict[str, Any] = {
        "title": title,
        "genre": genre,
        "kicker": kicker,
        "budget": budget,
        "hook": hook,
        "logline": logline,
        "connection": connection,
        "theme": theme,
        "market": market,
    }
    if archetype_names or archetype_notes:
        try:
            changes["archetypes"] = _archetypes(
                archetype_names or [], archetype_notes or []
            )
        except ProposalSpecError as exc:
            return _failed(str(exc))

    try:
        return _linked(store.update_proposal(proposal_id, changes), proposal_id)
    except store.ProposalError as exc:
        return _failed(str(exc))


update_proposal.__doc__ = _documents_limits(update_proposal.__doc__ or "")


def adopt_panel(
    proposal_id: str,
    dashboard_id: str,
    panel_id: str,
    title: str = "",
) -> dict[str, Any]:
    """Put a chart from one of your dashboards onto a proposal.

    This is the normal way to give a pitch its evidence. The proposal takes
    its own copy of the panel's query and spec, so editing or deleting that
    dashboard afterwards cannot change or break the proposal — and the
    report still says where the chart came from.

    Two to four charts is a proposal. Eight is a dashboard wearing a hat.

    Args:
        proposal_id: the proposal to add the chart to.
        dashboard_id: the dashboard the chart is on now.
        panel_id: the panel to copy, as returned by get_dashboard.
        title: retitle it for the proposal, or "" to keep the panel's own.
    """
    try:
        adopted = store.adopt_panel(proposal_id, dashboard_id, panel_id, title)
    except store.ProposalError as exc:
        return _failed(str(exc))
    return _linked(adopted, proposal_id)


@_documents_charts
def add_proposal_panel(
    proposal_id: str,
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
    """Put a chart straight on a proposal, with no dashboard behind it.

    Prefer adopt_panel. Use this only for evidence that does not belong on
    any dashboard you would keep.

    As with add_panel, the query is run before the chart is saved and every
    column it names is checked against what came back. If any is missing
    nothing is saved and the real column list comes back.

    Args:
        proposal_id: the proposal to add to.
        title: the chart's title.
        query: a single SELECT returning the columns named below. Keep it
            aggregated — a panel plots at most a few thousand points.
        chart_type: which chart to draw. Each type below lists the columns
            it takes; leave the others as "".
            {charts}
        x: the main dimension — the horizontal axis on a cartesian chart,
            the category on a funnel, the country on a map.
        y: the measure columns to plot, or the second dimension on a heatmap.
        series: optional column to split one measure into several lines or
            bars. Do not combine with several y columns.
        value: the single measure for charts whose dimensions occupy other
            slots — heatmap, calendar, treemap, sunburst, sankey, map,
            graph, tree, chord and lines.
        path: the columns forming a hierarchy for treemap and sunburst,
            outermost first.
        source: the column a sankey flow leaves.
        target: the column a sankey flow arrives at.
        stacked: stack the series instead of overlaying them.
        value_format: number, compact, percent, bytes, duration or currency.
        width: grid width out of 12.
        height: 1, 2 or 3 rows tall.
    """
    kind = charts.chart(chart_type)
    if kind is None:
        return _failed(
            f"unknown chart_type {chart_type!r}; use one of {CHART_TYPE_HELP}"
        )
    try:
        added = store.add_proposal_panel(
            proposal_id,
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
    except (store.ProposalError, DashboardError, SpecError) as exc:
        return _failed(str(exc))
    return _linked(added, proposal_id)


def delete_proposal_panel(proposal_id: str, panel_id: str) -> dict[str, Any]:
    """Take one chart off a proposal.

    Args:
        proposal_id: the proposal the chart is on.
        panel_id: the chart to remove, as returned by read_proposal.
    """
    try:
        store.delete_proposal_panel(proposal_id, panel_id)
    except store.ProposalError as exc:
        return _failed(str(exc))
    return {"ok": True, "deleted": panel_id}


def generate_still(
    proposal_id: str, prompt: str, aspect_ratio: str = "16:9"
) -> dict[str, Any]:
    """Generate the image that sits behind a proposal's title.

    Describe a place, a light and a time of day. Never a real or
    identifiable person, never a logo or a channel's branding, never the
    cast or artwork of a title that exists — those are refused, and the
    proposal keeps whatever it had.

    One is usually enough; the report shows a single hero. The limit is
    three per proposal, and each takes roughly half a minute.

    Args:
        proposal_id: the proposal the still belongs to.
        prompt: the scene. A room, a light, a time of day, a lens.
        aspect_ratio: one of 16:9, 4:3, 1:1, 3:4, 9:16, 21:9. The hero is
            wide, so keep 16:9 unless there is a reason not to.
    """
    if aspect_ratio not in ASPECT_RATIOS:
        return _failed(
            f"unknown aspect_ratio {aspect_ratio!r}; use one of "
            f"{', '.join(ASPECT_RATIOS)}"
        )
    # `url` in the result is where the image itself lives, which is not
    # somewhere to send a reader; `link` is the one-sheet it now sits on.
    return _linked(
        stills.generate_still(proposal_id, prompt, aspect_ratio), proposal_id
    )


def delete_proposal(proposal_id: str) -> dict[str, Any]:
    """Delete a proposal, its charts and its stills.

    Args:
        proposal_id: the proposal to delete.
    """
    try:
        return {"ok": True, **store.delete_proposal(proposal_id)}
    except store.ProposalError as exc:
        return _failed(str(exc))


# The full surface, in the order a model would normally reach for them.
PROPOSAL_TOOLS = [
    list_proposals,
    read_proposal,
    create_proposal,
    update_proposal,
    adopt_panel,
    add_proposal_panel,
    delete_proposal_panel,
    generate_still,
    delete_proposal,
]
