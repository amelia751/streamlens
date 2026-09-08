"""Where something the analyst made lives, as a path its reply can link to.

The link travels back with the tool result, so the model never assembles
one. Ids are generated here and the route belongs to the web app: a path the
model wrote from memory is a dead end the user only discovers by clicking
it, which is worse than no link at all.

Paths, not URLs. The canvas is one page holding tabs, so the chat follows
`/studio?dashboard=…` by opening the tab rather than reloading the app — and
the same path still resolves typed into an address bar or opened in a second
browser tab, which is what makes it a real link.

They also come back. A panel's copy button puts one of these on the
clipboard, and pasting it into the chat is how the user says "this chart" —
so this module reads them as well as writes them, and one vocabulary covers
both directions.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import parse_qs, quote, urlsplit

STUDIO = "/studio"


def dashboard_link(dashboard_id: str, panel_id: str = "") -> str:
    """The canvas with this dashboard open, and one panel expanded if given."""
    path = f"{STUDIO}?dashboard={quote(dashboard_id, safe='')}"
    if panel_id:
        path += f"&panel={quote(panel_id, safe='')}"
    return path


def proposal_link(proposal_id: str, panel_id: str = "") -> str:
    """The canvas with this proposal open, naming one of its charts if given.

    A proposal's charts are part of its argument and do not expand on their
    own, so the panel is context rather than a view: it is what the chat
    means when the user attaches one chart off a one-sheet.
    """
    path = f"{STUDIO}?proposal={quote(proposal_id, safe='')}"
    if panel_id:
        path += f"&panel={quote(panel_id, safe='')}"
    return path


@dataclass(frozen=True)
class Ref:
    """What a canvas path points at."""

    kind: str  # "dashboard" or "proposal"
    owner_id: str
    panel_id: str = ""

    @property
    def link(self) -> str:
        return (
            dashboard_link(self.owner_id, self.panel_id)
            if self.kind == "dashboard"
            else proposal_link(self.owner_id, self.panel_id)
        )


def read_link(href: str) -> Ref | None:
    """The dashboard or proposal a `/studio?…` path points at, if any.

    Takes a path or a whole URL, because what arrives here was on someone's
    clipboard: copied off a panel, or out of the address bar. The query stops
    at a `)` for the same reason — a link pasted out of prose brings the
    bracket that closed it, and our own ids are always percent-encoded.
    """
    parts = urlsplit(href)
    if parts.path.rstrip("/") != STUDIO:
        return None

    params = parse_qs(parts.query.split(")")[0])
    panel_id = (params.get("panel") or [""])[0]
    for kind in ("dashboard", "proposal"):
        owner_id = (params.get(kind) or [""])[0]
        if owner_id:
            return Ref(kind=kind, owner_id=owner_id, panel_id=panel_id)
    return None
