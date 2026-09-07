/**
 * Theme proposals the analyst drafts for filmmakers.
 *
 * List and detail both come from `/api/mock/proposals` today. Swap that
 * prefix for `/api/proposals` when the warehouse starts writing them.
 */

export type ProposalArchetype = {
  name: string;
  note: string;
};

export type ProposalSummary = {
  id: string;
  title: string;
  genre: string;
  kicker: string;
  still: string;
  dashboard_id: string;
  dashboard_title: string;
};

export type Proposal = ProposalSummary & {
  budget: string;
  hook: string;
  logline: string;
  connection: string;
  stills: string[];
  archetypes: ProposalArchetype[];
  story: string;
  market: string;
};

export type ProposalList = {
  proposals: ProposalSummary[];
};

export async function fetchProposals(): Promise<ProposalSummary[]> {
  const res = await fetch("/api/mock/proposals", { cache: "no-store" });
  if (!res.ok) throw new Error(`proposals ${res.status}`);
  const body = (await res.json()) as ProposalList;
  return body.proposals ?? [];
}

export async function fetchProposal(id: string): Promise<Proposal> {
  const res = await fetch(`/api/mock/proposals/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`proposal ${res.status}`);
  return res.json();
}
