"""Reading and writing proposals, and running the charts underneath them.

The one design decision worth restating here, because every function below
follows from it: **a proposal owns its panels, it does not point at them.**

`adopt_panel` copies a dashboard panel's query and spec into
`streamlens.proposal_panel` and records where it came from as a *label*.
Nothing in this module ever dereferences `source_dashboard_id` to render a
proposal. So tombstoning, editing or renaming the source dashboard cannot
break, change, or silently rewrite the evidence under a pitch someone has
already read. The provenance still shows, and degrades to plain text.

What is copied is the query, never the rows. The numbers stay live, the
same way a dashboard panel's do, so a pitch never quotes a six-month-old
figure.

Privileges are the dashboards' ones, unchanged. `run_panel_query` and
`check_panel` are imported rather than reimplemented: there must be exactly
one place in this codebase that decides whether model-authored SQL may run.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from streamlens.dashboards.spec import PanelSpec, parse_spec
from streamlens.dashboards.store import (
    DashboardError,
    check_panel,
    run_panel_query,
    slugify,
)
from streamlens.dashboards.store import get_dashboard as _get_dashboard
from streamlens.proposals.spec import (
    Archetype,
    ProposalDoc,
    ProposalSpecError,
    parse_doc,
    validate_doc,
)
from streamlens.services.clickhouse.clickhouse_services import shared_client

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

# Tight, because a proposal id becomes a GCS object prefix. Anything that
# would need escaping on the way into a key is refused before it gets there.
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

PROPOSAL_COLUMNS = [
    "id", "title", "genre", "kicker", "budget", "hook", "logline",
    "connection", "theme", "market", "archetypes",
    "source_dashboard_id", "source_dashboard_title",
    "updated_at", "is_deleted",
]

PANEL_COLUMNS = [
    "proposal_id", "id", "title", "query", "spec", "position", "width",
    "height", "source_dashboard_id", "source_panel_id", "source_query_hash",
    "updated_at", "is_deleted",
]

STILL_COLUMNS = [
    "proposal_id", "id", "object", "content_type", "bytes", "prompt",
    "model", "aspect_ratio", "position", "updated_at", "is_deleted",
]


class ProposalError(ValueError):
    """Raised with a message written to be read by the model."""


@dataclass
class ProposalPanel:
    """A chart the proposal owns. Same shape as a dashboard panel, plus
    where it was adopted from — which is a label, not a link."""

    proposal_id: str
    id: str
    title: str
    query: str
    spec: PanelSpec
    position: int
    width: int
    height: int
    source_dashboard_id: str = ""
    source_panel_id: str = ""
    source_query_hash: str = ""

    def to_dict(self) -> dict:
        return {
            "proposal_id": self.proposal_id,
            "id": self.id,
            "title": self.title,
            "query": self.query,
            "spec": self.spec.to_dict(),
            "position": self.position,
            "width": self.width,
            "height": self.height,
            "source_dashboard_id": self.source_dashboard_id,
            "source_panel_id": self.source_panel_id,
            "source_query_hash": self.source_query_hash,
        }


@dataclass
class Still:
    """A generated image. The bytes live in GCS; this is the accounting."""

    proposal_id: str
    id: str
    object: str
    content_type: str
    bytes: int
    prompt: str
    model: str
    aspect_ratio: str
    position: int

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "content_type": self.content_type,
            "bytes": self.bytes,
            "prompt": self.prompt,
            "model": self.model,
            "aspect_ratio": self.aspect_ratio,
            "position": self.position,
            # The only address anything outside this process gets. No signed
            # URL is ever minted, so a link cannot outlive its proposal.
            "url": still_url(self.proposal_id, self.id),
        }


@dataclass
class Proposal:
    id: str
    doc: ProposalDoc
    source_dashboard_id: str = ""
    source_dashboard_title: str = ""
    panels: list[ProposalPanel] = field(default_factory=list)
    stills: list[Still] = field(default_factory=list)

    def to_dict(self) -> dict:
        stills = [s.to_dict() for s in self.stills]
        return {
            "id": self.id,
            **self.doc.to_dict(),
            "source_dashboard_id": self.source_dashboard_id,
            "source_dashboard_title": self.source_dashboard_title,
            "panels": [p.to_dict() for p in self.panels],
            "stills": stills,
            # The hero. None rather than a placeholder path: the report
            # falls back to its tone gradient, which is better than a
            # broken <img>.
            "still_url": stills[0]["url"] if stills else None,
        }


def still_url(proposal_id: str, still_id: str) -> str:
    return f"/api/proposals/{proposal_id}/stills/{still_id}"


def _statements(sql: str) -> list[str]:
    """Split the schema file into statements, stripping comments first.

    Prose in that file contains semicolons; splitting before stripping would
    cut a statement in half at a semicolon that was only punctuation.
    """
    body = "\n".join(
        line for line in sql.splitlines() if not line.strip().startswith("--")
    )
    return [s for s in (chunk.strip() for chunk in body.split(";")) if s]


def ensure_schema() -> None:
    """Create the proposal tables if they are not there yet."""
    client = shared_client()
    for statement in _statements(SCHEMA_PATH.read_text()):
        client.command(statement)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def query_hash(query: str) -> str:
    """A stable fingerprint of a query, ignoring how it was whitespaced.

    Recorded when a panel is adopted so a later UI can notice the source
    chart has changed. It is never used to *follow* that change.
    """
    return hashlib.sha256(" ".join(query.split()).encode("utf-8")).hexdigest()[:16]


def check_proposal_id(proposal_id: str) -> str:
    """The id, or a refusal. Called before an id can reach a GCS key."""
    if not ID_PATTERN.match(proposal_id or ""):
        raise ProposalError(
            f"{proposal_id!r} is not a proposal id; ids are lowercase "
            "letters, digits and hyphens"
        )
    return proposal_id


# ------------------------------------------------------------- proposals


def list_proposals() -> list[dict[str, Any]]:
    """Every live proposal, newest first, for the rail."""
    rows = shared_client().query(
        """
        SELECT
            p.id, p.title, p.genre, p.kicker,
            p.source_dashboard_id, p.source_dashboard_title,
            ifNull(n.panels, 0), ifNull(s.still_id, '')
        FROM streamlens.proposal AS p FINAL
        LEFT JOIN (
            SELECT proposal_id, count() AS panels
            FROM streamlens.proposal_panel FINAL
            WHERE is_deleted = 0
            GROUP BY proposal_id
        ) AS n ON n.proposal_id = p.id
        LEFT JOIN (
            SELECT proposal_id, argMin(id, (position, id)) AS still_id
            FROM streamlens.proposal_still FINAL
            WHERE is_deleted = 0
            GROUP BY proposal_id
        ) AS s ON s.proposal_id = p.id
        WHERE p.is_deleted = 0
        ORDER BY p.updated_at DESC
        """
    ).result_rows
    return [
        {
            "id": r[0],
            "title": r[1],
            "genre": r[2],
            "kicker": r[3],
            "source_dashboard_id": r[4],
            "source_dashboard_title": r[5],
            "panel_count": int(r[6]),
            "still_url": still_url(r[0], r[7]) if r[7] else None,
        }
        for r in rows
    ]


def get_proposal(proposal_id: str) -> Proposal:
    """One proposal: the document, the panels it owns, and its stills."""
    client = shared_client()
    head = client.query(
        "SELECT id, title, genre, kicker, budget, hook, logline, connection, "
        "theme, market, archetypes, source_dashboard_id, source_dashboard_title "
        "FROM streamlens.proposal FINAL "
        "WHERE id = {id:String} AND is_deleted = 0",
        parameters={"id": proposal_id},
    ).result_rows
    if not head:
        raise ProposalError(f"no proposal with id {proposal_id!r}")

    row = head[0]
    try:
        archetypes_raw = json.loads(row[10] or "[]")
    except json.JSONDecodeError:
        archetypes_raw = []

    doc = ProposalDoc(
        title=row[1],
        genre=row[2],
        kicker=row[3],
        budget=row[4],
        hook=row[5],
        logline=row[6],
        connection=row[7],
        theme=row[8],
        market=row[9],
        archetypes=[
            Archetype(name=str(a.get("name", "")), note=str(a.get("note", "")))
            for a in archetypes_raw
            if isinstance(a, dict)
        ],
    )

    return Proposal(
        id=row[0],
        doc=doc,
        source_dashboard_id=row[11],
        source_dashboard_title=row[12],
        panels=_read_panels(proposal_id),
        stills=_read_stills(proposal_id),
    )


def _read_panels(proposal_id: str) -> list[ProposalPanel]:
    rows = shared_client().query(
        "SELECT id, title, query, spec, position, width, height, "
        "source_dashboard_id, source_panel_id, source_query_hash "
        "FROM streamlens.proposal_panel FINAL "
        "WHERE proposal_id = {id:String} AND is_deleted = 0 "
        "ORDER BY position, id",
        parameters={"id": proposal_id},
    ).result_rows
    return [
        ProposalPanel(
            proposal_id=proposal_id,
            id=r[0],
            title=r[1],
            query=r[2],
            spec=parse_spec(json.loads(r[3])),
            position=int(r[4]),
            width=int(r[5]),
            height=int(r[6]),
            source_dashboard_id=r[7],
            source_panel_id=r[8],
            source_query_hash=r[9],
        )
        for r in rows
    ]


def _read_stills(proposal_id: str) -> list[Still]:
    rows = shared_client().query(
        "SELECT id, object, content_type, bytes, prompt, model, aspect_ratio, "
        "position FROM streamlens.proposal_still FINAL "
        "WHERE proposal_id = {id:String} AND is_deleted = 0 "
        "ORDER BY position, id",
        parameters={"id": proposal_id},
    ).result_rows
    return [
        Still(
            proposal_id=proposal_id,
            id=r[0],
            object=r[1],
            content_type=r[2],
            bytes=int(r[3]),
            prompt=r[4],
            model=r[5],
            aspect_ratio=r[6],
            position=int(r[7]),
        )
        for r in rows
    ]


def _write_doc(
    proposal_id: str,
    doc: ProposalDoc,
    source_dashboard_id: str,
    source_dashboard_title: str,
    deleted: bool = False,
) -> None:
    shared_client().insert(
        "streamlens.proposal",
        [[
            proposal_id,
            doc.title,
            doc.genre,
            doc.kicker,
            doc.budget,
            doc.hook,
            doc.logline,
            doc.connection,
            doc.theme,
            doc.market,
            json.dumps([a.to_dict() for a in doc.archetypes]),
            source_dashboard_id,
            source_dashboard_title,
            _now(),
            1 if deleted else 0,
        ]],
        column_names=PROPOSAL_COLUMNS,
    )


def create_proposal(raw: dict) -> dict[str, Any]:
    """Validate a document and write it. Returns the check result.

    Nothing is saved when the document does not validate, and the problems
    come back phrased for whoever wrote it.
    """
    try:
        doc = parse_doc(raw)
    except ProposalSpecError as exc:
        return {"ok": False, "problems": [str(exc)]}

    problems = validate_doc(doc)
    if problems:
        return {"ok": False, "problems": problems}

    proposal_id = slugify(doc.title)
    existing = shared_client().query(
        "SELECT count() FROM streamlens.proposal FINAL "
        "WHERE id = {id:String} AND is_deleted = 0",
        parameters={"id": proposal_id},
    ).result_rows
    if existing and existing[0][0]:
        proposal_id = f"{proposal_id}-{uuid.uuid4().hex[:4]}"

    check_proposal_id(proposal_id)
    _write_doc(
        proposal_id,
        doc,
        str(raw.get("source_dashboard_id") or ""),
        str(raw.get("source_dashboard_title") or ""),
    )
    return {"ok": True, "proposal_id": proposal_id, "proposal": doc.to_dict()}


def update_proposal(proposal_id: str, changes: dict) -> dict[str, Any]:
    """Change the fields supplied and leave the rest as they are."""
    current = get_proposal(proposal_id)
    merged = current.doc.to_dict()
    for key, value in changes.items():
        if key in merged and value not in (None, "", []):
            merged[key] = value

    try:
        doc = parse_doc(merged)
    except ProposalSpecError as exc:
        return {"ok": False, "problems": [str(exc)]}

    problems = validate_doc(doc)
    if problems:
        return {"ok": False, "problems": problems}

    _write_doc(
        proposal_id,
        doc,
        str(changes.get("source_dashboard_id") or current.source_dashboard_id),
        str(
            changes.get("source_dashboard_title")
            or current.source_dashboard_title
        ),
    )
    return {"ok": True, "proposal_id": proposal_id, "proposal": doc.to_dict()}


def delete_proposal(proposal_id: str) -> dict[str, int]:
    """Tombstone a proposal, its panels and its stills.

    Three server-side INSERT … SELECTs. Pulling the rows through Python
    first is what hung the UI when dashboards did it — especially while the
    canvas was still replaying those same queries.

    The objects in GCS are deliberately left alone: nothing serves them any
    more, and `scripts/gcs/gc_proposal_stills.py` sweeps them later.
    """
    client = shared_client()
    found = client.query(
        "SELECT count() FROM streamlens.proposal FINAL "
        "WHERE id = {id:String} AND is_deleted = 0",
        parameters={"id": proposal_id},
    ).result_rows
    if not found or not found[0][0]:
        raise ProposalError(f"no proposal with id {proposal_id!r}")

    counts = client.query(
        "SELECT "
        "  (SELECT count() FROM streamlens.proposal_panel FINAL "
        "   WHERE proposal_id = {id:String} AND is_deleted = 0), "
        "  (SELECT count() FROM streamlens.proposal_still FINAL "
        "   WHERE proposal_id = {id:String} AND is_deleted = 0)",
        parameters={"id": proposal_id},
    ).result_rows[0]
    panels, stills = int(counts[0]), int(counts[1])

    client.command(
        "INSERT INTO streamlens.proposal "
        f"({', '.join(PROPOSAL_COLUMNS)}) "
        "SELECT id, title, genre, kicker, budget, hook, logline, connection, "
        "theme, market, archetypes, source_dashboard_id, "
        "source_dashboard_title, now64(3, 'UTC'), 1 "
        "FROM streamlens.proposal FINAL "
        "WHERE id = {id:String} AND is_deleted = 0",
        parameters={"id": proposal_id},
    )
    if panels:
        client.command(
            "INSERT INTO streamlens.proposal_panel "
            f"({', '.join(PANEL_COLUMNS)}) "
            "SELECT proposal_id, id, title, query, spec, position, width, "
            "height, source_dashboard_id, source_panel_id, source_query_hash, "
            "now64(3, 'UTC'), 1 "
            "FROM streamlens.proposal_panel FINAL "
            "WHERE proposal_id = {id:String} AND is_deleted = 0",
            parameters={"id": proposal_id},
        )
    if stills:
        client.command(
            "INSERT INTO streamlens.proposal_still "
            f"({', '.join(STILL_COLUMNS)}) "
            "SELECT proposal_id, id, object, content_type, bytes, prompt, "
            "model, aspect_ratio, position, now64(3, 'UTC'), 1 "
            "FROM streamlens.proposal_still FINAL "
            "WHERE proposal_id = {id:String} AND is_deleted = 0",
            parameters={"id": proposal_id},
        )
    return {"deleted_panels": panels, "deleted_stills": stills}


# ---------------------------------------------------------------- panels


def _write_panel(panel: ProposalPanel, deleted: bool = False) -> None:
    shared_client().insert(
        "streamlens.proposal_panel",
        [[
            panel.proposal_id,
            panel.id,
            panel.title,
            panel.query,
            json.dumps(panel.spec.to_dict()),
            panel.position,
            panel.width,
            panel.height,
            panel.source_dashboard_id,
            panel.source_panel_id,
            panel.source_query_hash,
            _now(),
            1 if deleted else 0,
        ]],
        column_names=PANEL_COLUMNS,
    )


def _next_position(proposal_id: str) -> int:
    return len(_read_panels(proposal_id))


def adopt_panel(
    proposal_id: str,
    dashboard_id: str,
    panel_id: str,
    title: str = "",
) -> dict[str, Any]:
    """Copy a live dashboard panel onto a proposal.

    This is the documented path for putting evidence on a pitch. What is
    copied is the definition — query, spec, and the shape it was drawn at.
    What is recorded about the dashboard is its id and *the title it had at
    this moment*, because ids are recycled: `create_dashboard` only checks
    live rows for a slug collision, so a tombstoned `youtube-overview` can
    be claimed later by something unrelated. Resolving the title at read
    time would eventually put the wrong name under someone's pitch.
    """
    proposal = get_proposal(proposal_id)

    try:
        dashboard = _get_dashboard(dashboard_id)
    except DashboardError as exc:
        return {"ok": False, "problems": [str(exc)]}

    source = next((p for p in dashboard.panels if p.id == panel_id), None)
    if source is None:
        known = ", ".join(p.id for p in dashboard.panels) or "none"
        return {
            "ok": False,
            "problems": [
                f"no panel {panel_id!r} on {dashboard_id!r}; panels are: {known}"
            ],
        }

    # Run it once on the way in. A panel that cannot be drawn today should
    # not be adopted as evidence today.
    check = check_panel(source.query, source.spec.to_dict())
    if not check["ok"]:
        return check

    panel = ProposalPanel(
        proposal_id=proposal_id,
        id=f"{slugify(title or source.title)}-{uuid.uuid4().hex[:4]}",
        title=title or source.title,
        query=source.query,
        spec=source.spec,
        position=len(proposal.panels),
        width=source.width,
        height=source.height,
        source_dashboard_id=dashboard_id,
        source_panel_id=panel_id,
        source_query_hash=query_hash(source.query),
    )
    _write_panel(panel)

    # A proposal that adopts its first chart from a dashboard names that
    # dashboard as its provenance, so the report can say where it came from.
    if not proposal.source_dashboard_id:
        _write_doc(proposal_id, proposal.doc, dashboard_id, dashboard.title)

    check["panel_id"] = panel.id
    check["panel"] = panel.to_dict()
    return check


def add_proposal_panel(
    proposal_id: str,
    title: str,
    query: str,
    spec_raw: dict,
    width: int = 6,
    height: int = 1,
) -> dict[str, Any]:
    """Put a chart on a proposal that has no dashboard behind it.

    Same gate as `dashboards.store.add_panel`: the query runs first and the
    spec is checked against the columns that actually came back.
    """
    proposal = get_proposal(proposal_id)
    check = check_panel(query, spec_raw)
    if not check["ok"]:
        return check

    panel = ProposalPanel(
        proposal_id=proposal_id,
        id=f"{slugify(title)}-{uuid.uuid4().hex[:4]}",
        title=title,
        query=query,
        spec=parse_spec(check["spec"]),
        position=len(proposal.panels),
        width=max(3, min(12, width)),
        height=max(1, min(3, height)),
        source_query_hash=query_hash(query),
    )
    _write_panel(panel)
    check["panel_id"] = panel.id
    check["panel"] = panel.to_dict()
    return check


def get_proposal_panel(proposal_id: str, panel_id: str) -> ProposalPanel:
    panel = next(
        (p for p in _read_panels(proposal_id) if p.id == panel_id), None
    )
    if panel is None:
        known = ", ".join(p.id for p in _read_panels(proposal_id)) or "none"
        raise ProposalError(
            f"no panel {panel_id!r} on {proposal_id!r}; panels are: {known}"
        )
    return panel


def update_proposal_panel(
    proposal_id: str,
    panel_id: str,
    title: str | None = None,
    query: str | None = None,
    spec_raw: dict | None = None,
    width: int | None = None,
    height: int | None = None,
    position: int | None = None,
) -> dict[str, Any]:
    """Change one panel on a proposal. Only what is supplied is touched."""
    current = get_proposal_panel(proposal_id, panel_id)

    next_query = query if query is not None else current.query
    next_spec = spec_raw if spec_raw is not None else current.spec.to_dict()

    check = check_panel(next_query, next_spec)
    if not check["ok"]:
        return check

    panel = ProposalPanel(
        proposal_id=proposal_id,
        id=panel_id,
        title=title if title is not None else current.title,
        query=next_query,
        spec=parse_spec(check["spec"]),
        position=position if position is not None else current.position,
        width=max(3, min(12, width)) if width is not None else current.width,
        height=max(1, min(3, height)) if height is not None else current.height,
        source_dashboard_id=current.source_dashboard_id,
        source_panel_id=current.source_panel_id,
        # The snapshot no longer matches what was adopted, so the fingerprint
        # follows the panel as it now stands rather than as it arrived.
        source_query_hash=query_hash(next_query),
    )
    _write_panel(panel)
    check["panel_id"] = panel_id
    check["panel"] = panel.to_dict()
    return check


def delete_proposal_panel(proposal_id: str, panel_id: str) -> None:
    _write_panel(get_proposal_panel(proposal_id, panel_id), deleted=True)


def run_proposal_panel(proposal_id: str, panel_id: str) -> dict[str, Any]:
    """Replay one panel's stored query. The proposal's own copy, read-only."""
    panel = get_proposal_panel(proposal_id, panel_id)
    result = run_panel_query(panel.query)
    return {
        "panel": panel.to_dict(),
        "columns": result["columns"],
        "types": result["types"],
        "rows": result["rows"],
    }


# ---------------------------------------------------------------- stills


def count_stills(proposal_id: str) -> int:
    rows = shared_client().query(
        "SELECT count() FROM streamlens.proposal_still FINAL "
        "WHERE proposal_id = {id:String} AND is_deleted = 0",
        parameters={"id": proposal_id},
    ).result_rows
    return int(rows[0][0]) if rows else 0


def add_still(still: Still) -> None:
    """Record an image that is already in the bucket.

    Called only by `proposals.stills`, after the bytes have landed — so a
    row never advertises an object that does not exist.
    """
    shared_client().insert(
        "streamlens.proposal_still",
        [[
            still.proposal_id,
            still.id,
            still.object,
            still.content_type,
            still.bytes,
            still.prompt,
            still.model,
            still.aspect_ratio,
            still.position,
            _now(),
            0,
        ]],
        column_names=STILL_COLUMNS,
    )


def get_still(proposal_id: str, still_id: str) -> Still:
    still = next(
        (s for s in _read_stills(proposal_id) if s.id == still_id), None
    )
    if still is None:
        raise ProposalError(f"no still {still_id!r} on {proposal_id!r}")
    return still
