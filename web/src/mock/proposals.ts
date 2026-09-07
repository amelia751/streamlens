/**
 * Stand-in theme proposals.
 *
 * The rail and the report fetch this through `/api/mock/proposals`.
 * Delete this module when a real store exists — do not import it from UI.
 */

import type { Proposal } from "@/lib/proposals";

export const PROPOSALS: Proposal[] = [
  {
    id: "after-dark-after-scroll",
    title: "After Dark, After Scroll",
    genre: "Suspense",
    kicker: "Late-night window",
    still: "/mock/after-dark-still.png",
    dashboard_id: "youtube-overview",
    dashboard_title: "YouTube Overview",
    budget: "$18–28M",
    hook: "A thriller that only works in the hours people still have a tab open.",
    logline:
      "Someone is watching the same three videos every night after 1am. The person who uploaded them starts watching back.",
    connection:
      "Overview hours pile up after midnight while subscriber growth is flat. The audience is already in the room; they just will not admit it in daylight.",
    stills: ["/mock/after-dark-still.png"],
    archetypes: [
      { name: "The uploader", note: "Knows the comments. Does not know the viewer." },
      { name: "The regular", note: "Same three titles. Never subscribed." },
      { name: "The clip", note: "Ninety seconds that should have stayed buried." },
      { name: "The premiere chat", note: "One handle that never misses a go-live." },
      { name: "The algorithm", note: "Keeps serving the same three. Will not say why." },
      { name: "The last video", note: "Not for the feed. A time and a place." },
      { name: "The roommate", note: "Sleeps through it. The TV does not." },
    ],
    story:
      "A late-night habit, not a plot. Someone keeps the same three titles open after 1am. The person who uploaded them starts to notice that the numbers have a face.\n\nThe theme is anonymity breaking. Not a chase and not a twist — the catalog after midnight as a room two people are already in.\n\nWrite the window, not the ending. The warehouse already proves the hours exist.",
    market:
      "YouTube Overview already shows the after-midnight lift. Pair it with a contained budget and a two-hander. The warehouse is the pitch: this audience exists before a single scene is written.",
  },
  {
    id: "ninety-seconds-then-cut",
    title: "Ninety Seconds, Then Cut",
    genre: "Comedy",
    kicker: "Shorts-native",
    still: "/mock/ninety-seconds-still.png",
    dashboard_id: "shorts-vs-longform",
    dashboard_title: "Shorts vs Longform",
    budget: "$8–14M",
    hook: "A comedy that starts in the length people already finish.",
    logline:
      "A punchline that works at 0:58 keeps getting remade — first as a short, then as a scene, then as the thing the scene was hiding.",
    connection:
      "Shorts vs Longform is not a format war. It is a filter: what survives ninety seconds is what a room will sit for.",
    stills: ["/mock/ninety-seconds-still.png"],
    archetypes: [
      { name: "The bit", note: "Lives on a phone. Dies if you explain it." },
      { name: "The expander", note: "Keeps adding a second beat until it is a movie." },
      { name: "The original", note: "Posted it first. Does not own it anymore." },
      { name: "The duet", note: "Steals the cut and makes it travel." },
      { name: "The comment", note: "Becomes the sequel nobody asked to write." },
      { name: "The brand", note: "Wants thirty seconds and the same laugh." },
      { name: "The editor", note: "Cuts it shorter every pass." },
    ],
    story:
      "Start in the length people already finish. A punchline that works at 0:58 does not need a first act invented for it.\n\nThe feature exists because the short made a promise a minute cannot keep. The theme is expansion: what you owe the laugh once it leaves the phone.\n\nStay general. The cut is the idea. Plot comes later, if it earns the last frame the short already gave away.",
    market:
      "Shorts vs Longform already splits the catalog. A shorts-native comedy does not need to invent the audience — it needs a second act the short cannot hold.",
  },
  {
    id: "the-home-market",
    title: "The Home Market",
    genre: "Drama",
    kicker: "Who it is #1 for",
    still: "/mock/home-market-still.png",
    dashboard_id: "youtube-channel-activity-network-growth",
    dashboard_title: "YouTube Channel Activity & Network Growth",
    budget: "$12–20M",
    hook: "A family story aimed at the country where the title is already #1 — not the one that financed it.",
    logline:
      "A daughter flies home for a week she cannot extend. The city that streams her is not the city on her ticket.",
    connection:
      "Channel activity grows in markets the network did not plan for. The home audience is already counting the title as theirs.",
    stills: ["/mock/home-market-still.png"],
    archetypes: [
      { name: "The visitor", note: "Has a return flight. The table does not." },
      { name: "The household", note: "Kept her chair. Changed the channel." },
      { name: "The other city", note: "Where the views actually are." },
      { name: "The empty chair", note: "Set for four. Three sit down." },
      { name: "The cousin", note: "Streamed it first. Will not translate." },
      { name: "The producer", note: "Calls that market secondary." },
      { name: "The remote", note: "The language on it is the argument." },
    ],
    story:
      "Write toward the country that already claimed the title, not the one that financed it. The family on screen is watching a different country's version of themselves.\n\nThe theme is recognition. Home is the market that kept the hours, not the city on the call sheet.\n\nDo not lock a plot. Name the kitchen the warehouse already says is watching.",
    market:
      "Network growth is not evenly spread. The chart is the argument: pick the market that is already watching, then write the kitchen that market would recognize.",
  },
];

export function listProposals(): Pick<
  Proposal,
  | "id"
  | "title"
  | "genre"
  | "kicker"
  | "still"
  | "dashboard_id"
  | "dashboard_title"
>[] {
  return PROPOSALS.map(
    ({ id, title, genre, kicker, still, dashboard_id, dashboard_title }) => ({
      id,
      title,
      genre,
      kicker,
      still,
      dashboard_id,
      dashboard_title,
    }),
  );
}

export function getProposal(id: string): Proposal | undefined {
  return PROPOSALS.find((proposal) => proposal.id === id);
}
