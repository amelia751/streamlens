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
    ],
    meet: "A kitchen TV left on. A phone face-down that lights up anyway. The city is empty enough that you can hear the next video autoplay.",
    beats: [
      {
        label: "Where it starts",
        text: "A channel that only spikes after 1am. No campaign. No premiere. Just a habit.",
      },
      {
        label: "Where it turns",
        text: "The uploader notices the same anonymous viewer in every premiere chat — and starts leaving messages only that person would understand.",
      },
      {
        label: "Where it lands",
        text: "The last video is not for the algorithm. It is a meeting time.",
      },
    ],
    leave: "Not a finished plot. A window: late-night catalog, one obsessive viewer, and a creator who can no longer pretend the numbers are anonymous.",
    market:
      "YouTube Overview already shows the after-midnight lift. Pair it with a contained budget and a two-hander. The warehouse is the pitch: this audience exists before a single scene is written.",
    charts: [
      {
        title: "Hours after midnight",
        caption: "Each bar is a daypart from YouTube Overview. Taller means more hours watched.",
        dashboard_id: "youtube-overview",
        dashboard_title: "YouTube Overview",
        format: "compact",
        tone: "purple",
        bars: [
          { label: "6a–12p", value: 4_100_000 },
          { label: "12p–6p", value: 6_800_000 },
          { label: "6p–12a", value: 9_400_000 },
          { label: "12a–6a", value: 11_200_000 },
        ],
      },
    ],
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
    ],
    meet: "A train, a lock screen, a laugh that is already over. Nobody in the car is watching the same thing and they all look like they are.",
    beats: [
      {
        label: "Where it starts",
        text: "One short that travels. No plot yet — just a cut people replay.",
      },
      {
        label: "Where it turns",
        text: "The longform version exists because the short made a promise it could not keep in a minute.",
      },
      {
        label: "Where it lands",
        text: "The movie has to earn the last cut the short already gave away.",
      },
    ],
    leave: "A theme, not a script: start in the length that already works, then spend the feature on why that laugh was cheaper than it looked.",
    market:
      "Shorts vs Longform already splits the catalog. A shorts-native comedy does not need to invent the audience — it needs a second act the short cannot hold.",
    charts: [
      {
        title: "Shorts vs longform",
        caption: "Share of uploads from Shorts vs Longform. Read across, not as a winner.",
        dashboard_id: "shorts-vs-longform",
        dashboard_title: "Shorts vs Longform",
        format: "percent",
        tone: "green",
        bars: [
          { label: "Shorts", value: 0.62 },
          { label: "Longform", value: 0.38 },
        ],
      },
    ],
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
    ],
    meet: "A kitchen set for four. Three people. A livestream from a timezone that is already tomorrow.",
    beats: [
      {
        label: "Where it starts",
        text: "A title that is #1 in a market the producers treat as secondary.",
      },
      {
        label: "Where it turns",
        text: "The family in the film is watching a different country's version of themselves.",
      },
      {
        label: "Where it lands",
        text: "Home is the market that kept the hours, not the one on the call sheet.",
      },
    ],
    leave: "Write toward the country that already claimed the story. The warehouse names it before the treatment does.",
    market:
      "Network growth is not evenly spread. The chart is the argument: pick the market that is already watching, then write the kitchen that market would recognize.",
    charts: [
      {
        title: "Hours by market",
        caption: "Each bar is a market from channel activity. Taller means more hours on the network.",
        dashboard_id: "youtube-channel-activity-network-growth",
        dashboard_title: "YouTube Channel Activity & Network Growth",
        format: "compact",
        tone: "blue",
        bars: [
          { label: "PH", value: 2_400_000 },
          { label: "MX", value: 1_900_000 },
          { label: "BR", value: 1_600_000 },
          { label: "US", value: 1_100_000 },
          { label: "GB", value: 700_000 },
        ],
      },
    ],
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
