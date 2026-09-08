/**
 * Theme proposals the analyst drafts for filmmakers.
 *
 * A proposal owns its charts rather than pointing at a dashboard's. The
 * panels below are the proposal's own copies, fetched with the document
 * and replayed from `/api/proposals/:id/panels/:panelId`, so deleting or
 * editing the dashboard a chart was adopted from cannot change or break
 * the pitch. `source_dashboard_*` is provenance — a label to render, never
 * an id to follow.
 */

import { BACKEND_URL, type PanelSpec } from "@/lib/api";

export type ProposalArchetype = {
  name: string;
  note: string;
};

/** A chart the proposal owns, with a note of where it was adopted from. */
export type ProposalPanel = {
  proposal_id: string;
  id: string;
  title: string;
  query: string;
  spec: PanelSpec;
  position: number;
  width: number;
  height: number;
  source_dashboard_id: string;
  source_panel_id: string;
  source_query_hash: string;
};

/** A generated still. The bytes are served by the backend, never publicly. */
export type ProposalStill = {
  id: string;
  content_type: string;
  bytes: number;
  prompt: string;
  model: string;
  aspect_ratio: string;
  position: number;
  url: string;
};

export type ProposalSummary = {
  id: string;
  title: string;
  genre: string;
  kicker: string;
  source_dashboard_id: string;
  source_dashboard_title: string;
  panel_count: number;
  /** Null when nothing was generated; the report falls back to a gradient. */
  still_url: string | null;
};

export type Proposal = {
  id: string;
  title: string;
  genre: string;
  kicker: string;
  budget: string;
  hook: string;
  logline: string;
  connection: string;
  theme: string;
  market: string;
  archetypes: ProposalArchetype[];
  source_dashboard_id: string;
  source_dashboard_title: string;
  panels: ProposalPanel[];
  stills: ProposalStill[];
  still_url: string | null;
};

/** The rail's first paint, rendered on the server. */
export async function fetchProposalsFromBackend(): Promise<ProposalSummary[]> {
  const res = await fetch(`${BACKEND_URL}/api/proposals`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`proposals ${res.status}: ${await res.text()}`);
  }
  return (await res.json()).proposals ?? [];
}
