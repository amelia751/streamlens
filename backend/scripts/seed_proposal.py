"""Port the three hand-written proposals into real warehouse rows.

This is the check that the store works before any model is involved: the
same three one-sheets the UI used to read out of `web/src/mock`, written
through `create_proposal` and `adopt_panel` against the three live
dashboards.

Panels are named by title rather than by id. Panel ids carry a random
suffix, so hard-coding them here would break the next time a dashboard is
rebuilt — and this script exists precisely to be re-runnable.

    uv run python scripts/seed_proposal.py
    uv run python scripts/seed_proposal.py --stills

Stills are behind a flag because each one is roughly 25 seconds of latency
and a real Vertex call, and the report is built to render without them.
"""

from __future__ import annotations

import sys

from streamlens.dashboards import store as dashboards
from streamlens.proposals import stills as proposal_stills
from streamlens.proposals import store

# (proposal document, dashboard id, panel titles to adopt, hero prompt)
#
# The prompts describe a place, a light and a time of day, and nothing else
# — the same rule the agent is given. `stills.CONSTRAINTS` is appended to
# each of them server-side.
PROPOSALS: list[tuple[dict, str, list[str], str]] = [
    (
        {
            "title": "After Dark, After Scroll",
            "genre": "Suspense",
            "kicker": "Late-night window",
            "budget": "$18–28M",
            "hook": "A thriller that only works in the hours people still have a tab open.",
            "logline": (
                "Someone is watching the same three videos every night after "
                "1am. The person who uploaded them starts watching back."
            ),
            "connection": (
                "Overview hours pile up after midnight while subscriber growth "
                "is flat. The audience is already in the room; they just will "
                "not admit it in daylight."
            ),
            "story": (
                "A late-night habit, not a plot. Someone keeps the same three "
                "titles open after 1am. The person who uploaded them starts to "
                "notice that the numbers have a face.\n\n"
                "The theme is anonymity breaking. Not a chase and not a twist "
                "— the catalog after midnight as a room two people are already "
                "in.\n\n"
                "Write the window, not the ending. The warehouse already proves "
                "the hours exist."
            ),
            "market": (
                "YouTube Overview already shows the after-midnight lift. Pair it "
                "with a contained budget and a two-hander. The warehouse is the "
                "pitch: this audience exists before a single scene is written."
            ),
            "archetypes": [
                {"name": "The uploader", "note": "Knows the comments. Does not know the viewer."},
                {"name": "The regular", "note": "Same three titles. Never subscribed."},
                {"name": "The clip", "note": "Ninety seconds that should have stayed buried."},
                {"name": "The premiere chat", "note": "One handle that never misses a go-live."},
                {"name": "The algorithm", "note": "Keeps serving the same three. Will not say why."},
                {"name": "The last video", "note": "Not for the feed. A time and a place."},
                {"name": "The roommate", "note": "Sleeps through it. The TV does not."},
            ],
        },
        "youtube-overview",
        [
            "Total Network Subscribers",
            "Monthly Video Uploads (2020–2026)",
            "Top 10 Channels by Total Views",
        ],
        "A dark one-room apartment at 2am, lit only by a laptop screen and "
        "the blue wash of a television nobody turned off. Rain on the window, "
        "an empty chair pushed back from a desk, the city out of focus beyond "
        "the glass. Cold blue against sodium orange, shallow depth of field, "
        "35mm, no people in frame.",
    ),
    (
        {
            "title": "Ninety Seconds, Then Cut",
            "genre": "Comedy",
            "kicker": "Shorts-native",
            "budget": "$8–14M",
            "hook": "A comedy that starts in the length people already finish.",
            "logline": (
                "A punchline that works at 0:58 keeps getting remade — first as "
                "a short, then as a scene, then as the thing the scene was "
                "hiding."
            ),
            "connection": (
                "Shorts vs Longform is not a format war. It is a filter: what "
                "survives ninety seconds is what a room will sit for."
            ),
            "story": (
                "Start in the length people already finish. A punchline that "
                "works at 0:58 does not need a first act invented for it.\n\n"
                "The feature exists because the short made a promise a minute "
                "cannot keep. The theme is expansion: what you owe the laugh "
                "once it leaves the phone.\n\n"
                "Stay general. The cut is the idea. Plot comes later, if it "
                "earns the last frame the short already gave away."
            ),
            "market": (
                "Shorts vs Longform already splits the catalog. A shorts-native "
                "comedy does not need to invent the audience — it needs a second "
                "act the short cannot hold."
            ),
            "archetypes": [
                {"name": "The bit", "note": "Lives on a phone. Dies if you explain it."},
                {"name": "The expander", "note": "Keeps adding a second beat until it is a movie."},
                {"name": "The original", "note": "Posted it first. Does not own it anymore."},
                {"name": "The duet", "note": "Steals the cut and makes it travel."},
                {"name": "The comment", "note": "Becomes the sequel nobody asked to write."},
                {"name": "The brand", "note": "Wants thirty seconds and the same laugh."},
                {"name": "The editor", "note": "Cuts it shorter every pass."},
            ],
        },
        "shorts-vs-longform",
        [
            "Monthly Viewership by Video Format",
            "Audience Like Engagement Rate by Format",
        ],
        "A small comedy club stage at closing time, house lights up, one "
        "stool and a microphone stand left in the middle, chairs stacked on "
        "tables at the back. Warm amber light, empty room, faint haze, 50mm, "
        "no people in frame.",
    ),
    (
        {
            "title": "The Home Market",
            "genre": "Drama",
            "kicker": "Who it is #1 for",
            "budget": "$12–20M",
            "hook": (
                "A family story aimed at the country where the title is already "
                "#1 — not the one that financed it."
            ),
            "logline": (
                "A daughter flies home for a week she cannot extend. The city "
                "that streams her is not the city on her ticket."
            ),
            "connection": (
                "Channel activity grows in markets the network did not plan for. "
                "The home audience is already counting the title as theirs."
            ),
            "story": (
                "Write toward the country that already claimed the title, not "
                "the one that financed it. The family on screen is watching a "
                "different country's version of themselves.\n\n"
                "The theme is recognition. Home is the market that kept the "
                "hours, not the city on the call sheet.\n\n"
                "Do not lock a plot. Name the kitchen the warehouse already says "
                "is watching."
            ),
            "market": (
                "Network growth is not evenly spread. The chart is the argument: "
                "pick the market that is already watching, then write the kitchen "
                "that market would recognize."
            ),
            "archetypes": [
                {"name": "The visitor", "note": "Has a return flight. The table does not."},
                {"name": "The household", "note": "Kept her chair. Changed the channel."},
                {"name": "The other city", "note": "Where the views actually are."},
                {"name": "The empty chair", "note": "Set for four. Three sit down."},
                {"name": "The cousin", "note": "Streamed it first. Will not translate."},
                {"name": "The producer", "note": "Calls that market secondary."},
                {"name": "The remote", "note": "The language on it is the argument."},
            ],
        },
        "youtube-channel-activity-network-growth",
        [
            "Top 10 Channels by Subscriber Base",
            "Subscriber Share by Channel Type",
            "Monthly Upload Velocity by Video Format",
        ],
        "A family kitchen at dusk in a warm coastal city, table set for four "
        "with three chairs pulled out and one still tucked in, a television "
        "glowing in the next room. Late golden light through a window, worn "
        "tile, no people in frame, 40mm.",
    ),
]


def _panel_id(dashboard_id: str, title: str) -> str | None:
    """Resolve a panel title to its id on a live dashboard."""
    try:
        dashboard = dashboards.get_dashboard(dashboard_id)
    except dashboards.DashboardError:
        return None
    panel = next((p for p in dashboard.panels if p.title == title), None)
    return panel.id if panel else None


def main(with_stills: bool = False) -> None:
    store.ensure_schema()

    for doc, dashboard_id, panel_titles, still_prompt in PROPOSALS:
        # Re-runnable: the previous copy is tombstoned so the slug is free
        # and the ids stay the ones the UI already links to.
        slug = dashboards.slugify(doc["title"])
        try:
            store.delete_proposal(slug)
            print(f"removed the previous {slug}")
        except store.ProposalError:
            pass

        result = store.create_proposal(doc)
        if not result.get("ok"):
            print(f"FAIL {doc['title']}")
            for problem in result["problems"]:
                print(f"       {problem}")
            continue

        proposal_id = result["proposal_id"]
        print(f"ok   {proposal_id}")

        for title in panel_titles:
            panel_id = _panel_id(dashboard_id, title)
            if panel_id is None:
                print(f"       skipped {title!r} — not on {dashboard_id}")
                continue
            adopted = store.adopt_panel(proposal_id, dashboard_id, panel_id)
            if adopted.get("ok"):
                print(f"       adopted {title}")
            else:
                for problem in adopted.get("problems", []):
                    print(f"       {problem}")

        if with_stills:
            result = proposal_stills.generate_still(proposal_id, still_prompt)
            if result.get("ok"):
                print(f"       still   {result['bytes']:,} bytes via {result['model']}")
            else:
                # A proposal without a still is still a proposal; the hero
                # falls back to its tone gradient.
                for problem in result.get("problems", []):
                    print(f"       still   skipped — {problem}")

    print("\nhttp://localhost:3000/studio")


if __name__ == "__main__":
    main(with_stills="--stills" in sys.argv[1:])
