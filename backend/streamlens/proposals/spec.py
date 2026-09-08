"""The proposal document: what a one-sheet is made of, and what is too much.

A proposal is prose, so unlike a panel spec there is nothing here to check
against a query result. What there is instead is shape: a closed genre
vocabulary, a length cap per field, and bounds on how many archetypes a
cast can hold.

The caps are not arbitrary. `components/proposal.tsx` gives each field a
fixed place — a slate chip, a blockquote, a two-column pane — and a model
that writes four paragraphs into `hook` does not produce a worse pitch, it
produces a broken page. Validation is the layout's contract, stated once.

Problems come back as a list of sentences the model can act on, mirroring
`dashboards/spec.py`, rather than as exceptions.
"""

from __future__ import annotations

from dataclasses import dataclass, field

__all__ = [
    "Archetype",
    "GENRES",
    "MAX_ARCHETYPES",
    "MIN_ARCHETYPES",
    "ProposalDoc",
    "ProposalSpecError",
    "genre_list",
    "parse_doc",
    "validate_doc",
]


class ProposalSpecError(ValueError):
    """Raised with a message written to be read by the model."""


# Closed, because the report colours the whole page from the genre. Free
# text would quietly mean "everything is purple" — the fallback tone — for
# every genre nobody thought to enumerate. Adding one is an entry here plus
# an entry in `toneFor` on the web side.
GENRES: tuple[str, ...] = (
    "Action",
    "Animation",
    "Comedy",
    "Crime",
    "Documentary",
    "Drama",
    "Family",
    "Fantasy",
    "Horror",
    "Romance",
    "Sci-Fi",
    "Suspense",
    "Thriller",
)

MIN_ARCHETYPES = 2
MAX_ARCHETYPES = 8

# Per field: how long it may be, and what it is, phrased for the model.
LIMITS: dict[str, tuple[int, str]] = {
    "title": (80, "the working title"),
    "kicker": (60, "the one-line angle shown beside the genre"),
    "budget": (40, "a band, e.g. \"$18-28M\" — not a single figure"),
    "hook": (220, "one sentence over the still"),
    "logline": (320, "one or two sentences, the pitch itself"),
    "connection": (600, "what the warehouse finding has to do with the idea"),
    "theme": (1400, "two short paragraphs on what the film is about"),
    "market": (900, "the argument the charts underneath are making"),
}

ARCHETYPE_NAME_MAX = 48
ARCHETYPE_NOTE_MAX = 120

# Every field a proposal must actually have. A one-sheet with an empty
# slate chip or a missing "The room" renders as a hole, not as brevity.
REQUIRED = ("title", "genre", "kicker", "budget", "hook", "logline",
            "connection", "theme", "market")


def genre_list() -> str:
    return ", ".join(GENRES)


def _canonical_genre(raw: str) -> str | None:
    """The vocabulary entry `raw` names, ignoring case and stray spacing."""
    wanted = raw.strip().lower().replace(" ", "-")
    for genre in GENRES:
        if genre.lower() == wanted:
            return genre
    return None


@dataclass
class Archetype:
    """One member of the cast: a role, and what is true about them."""

    name: str
    note: str

    def to_dict(self) -> dict:
        return {"name": self.name, "note": self.note}


@dataclass
class ProposalDoc:
    """The prose half of a proposal. The charts are stored separately."""

    title: str
    genre: str
    kicker: str = ""
    budget: str = ""
    hook: str = ""
    logline: str = ""
    connection: str = ""
    theme: str = ""
    market: str = ""
    archetypes: list[Archetype] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "genre": self.genre,
            "kicker": self.kicker,
            "budget": self.budget,
            "hook": self.hook,
            "logline": self.logline,
            "connection": self.connection,
            "theme": self.theme,
            "market": self.market,
            "archetypes": [a.to_dict() for a in self.archetypes],
        }


def parse_doc(raw: dict) -> ProposalDoc:
    """Turn a dict into a document, or say what is unreadable about it.

    Only structural failures raise here — a genre that is not in the
    vocabulary or a field that is too long is a *problem*, reported by
    `validate_doc`, because the model can fix those without being told the
    shape again.
    """
    if not isinstance(raw, dict):
        raise ProposalSpecError("a proposal must be a JSON object")

    def text(key: str) -> str:
        value = raw.get(key, "")
        if value is None:
            return ""
        if not isinstance(value, (str, int, float)):
            raise ProposalSpecError(f"{key!r} must be text")
        return str(value).strip()

    archetypes_raw = raw.get("archetypes") or []
    if not isinstance(archetypes_raw, list):
        raise ProposalSpecError(
            "'archetypes' must be a list of {name, note} objects"
        )

    archetypes: list[Archetype] = []
    for entry in archetypes_raw:
        if not isinstance(entry, dict):
            raise ProposalSpecError(
                "each archetype must be an object with 'name' and 'note'"
            )
        name = str(entry.get("name", "")).strip()
        note = str(entry.get("note", "")).strip()
        if not name:
            raise ProposalSpecError("every archetype needs a name")
        archetypes.append(Archetype(name=name, note=note))

    genre_raw = text("genre")
    return ProposalDoc(
        title=text("title"),
        # Normalised on the way in so "comedy" and "Comedy" store the same
        # value and colour the same page. An unknown genre is kept verbatim
        # so validate_doc can quote back what was actually written.
        genre=_canonical_genre(genre_raw) or genre_raw,
        kicker=text("kicker"),
        budget=text("budget"),
        hook=text("hook"),
        logline=text("logline"),
        connection=text("connection"),
        theme=text("theme"),
        market=text("market"),
        archetypes=archetypes,
    )


def validate_doc(doc: ProposalDoc) -> list[str]:
    """Everything wrong with a document, phrased so it can be corrected.

    An empty list means the proposal is renderable.
    """
    problems: list[str] = []

    for name in REQUIRED:
        if not getattr(doc, name, "").strip():
            what = LIMITS.get(name, (0, ""))[1]
            problems.append(
                f"a proposal needs a {name!r}"
                + (f" — {what}" if what else "")
            )

    if doc.genre and _canonical_genre(doc.genre) is None:
        problems.append(
            f"unknown genre {doc.genre!r}; use one of {genre_list()}"
        )

    for name, (cap, what) in LIMITS.items():
        value = getattr(doc, name, "")
        if len(value) > cap:
            problems.append(
                f"{name!r} is {len(value)} characters; the report gives it "
                f"{cap} — {what}"
            )

    count = len(doc.archetypes)
    if count and count < MIN_ARCHETYPES:
        problems.append(
            f"a cast of {count} is not a cast; give at least {MIN_ARCHETYPES} "
            "archetypes, or none at all"
        )
    if count > MAX_ARCHETYPES:
        problems.append(
            f"{count} archetypes is more than the report can show; "
            f"keep it to {MAX_ARCHETYPES}"
        )

    seen: set[str] = set()
    for person in doc.archetypes:
        key = person.name.lower()
        if key in seen:
            problems.append(f"two archetypes are both called {person.name!r}")
        seen.add(key)
        if len(person.name) > ARCHETYPE_NAME_MAX:
            problems.append(
                f"archetype name {person.name[:24]!r}… is longer than "
                f"{ARCHETYPE_NAME_MAX} characters"
            )
        if len(person.note) > ARCHETYPE_NOTE_MAX:
            problems.append(
                f"the note on {person.name!r} is longer than "
                f"{ARCHETYPE_NOTE_MAX} characters; one line, not a paragraph"
            )

    return problems
