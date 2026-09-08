/**
 * Paths to things on the canvas, and how to read one back.
 *
 * The same vocabulary the backend writes into tool results
 * (`streamlens/links.py`), because these paths travel: the analyst puts them
 * in its replies, a panel's copy button puts one on the clipboard, and the
 * chat hands them back to the agent as what the user is pointing at. One
 * shape, so a link the agent wrote and a link the user copied are the same
 * thing to everything downstream.
 */

export type Ref =
  | { kind: "dashboard"; id: string; panelId?: string }
  | { kind: "proposal"; id: string; panelId?: string };

export function dashboardLink(dashboardId: string, panelId?: string): string {
  const path = `/studio?dashboard=${encodeURIComponent(dashboardId)}`;
  return panelId ? `${path}&panel=${encodeURIComponent(panelId)}` : path;
}

export function proposalLink(proposalId: string, panelId?: string): string {
  const path = `/studio?proposal=${encodeURIComponent(proposalId)}`;
  return panelId ? `${path}&panel=${encodeURIComponent(panelId)}` : path;
}

/**
 * What a `/studio?…` path points at, or null if it points at nothing.
 *
 * Reads a path, a whole URL, or one still wrapped in the markdown link the
 * copy button writes — so the query stops at the first `)` or space, which is
 * where the address ends and the sentence around it begins. Our own ids are
 * always percent-encoded, so neither can be part of one.
 */
export function readLink(href: string): Ref | null {
  const at = href.indexOf("/studio?");
  if (at === -1) return null;
  const query = href.slice(at + "/studio?".length).split(/[)\s]/)[0];
  const params = new URLSearchParams(query);

  const panelId = params.get("panel") || undefined;
  const dashboard = params.get("dashboard");
  if (dashboard) return { kind: "dashboard", id: dashboard, panelId };
  const proposal = params.get("proposal");
  if (proposal) return { kind: "proposal", id: proposal, panelId };
  return null;
}

export function refLink(ref: Ref): string {
  return ref.kind === "dashboard"
    ? dashboardLink(ref.id, ref.panelId)
    : proposalLink(ref.id, ref.panelId);
}

/**
 * Every canvas path in a block of pasted text, and the text without them.
 *
 * Written to survive however the path arrived: bare, absolute, or wrapped in
 * the markdown link the copy button writes and the analyst's replies use.
 * What is left over is what the user actually typed around it, which is the
 * message — a chip standing for the chart says more than the URL would.
 */
const PASTED =
  /\[[^\]]*\]\((?:https?:\/\/[^)\s]+)?\/studio\?[^)\s]+\)|(?:https?:\/\/\S+)?\/studio\?\S+/g;

export function readPasted(text: string): { refs: Ref[]; rest: string } {
  const refs: Ref[] = [];
  for (const match of text.match(PASTED) ?? []) {
    const ref = readLink(match);
    if (ref) refs.push(ref);
  }
  if (refs.length === 0) return { refs, rest: text };
  return { refs, rest: text.replace(PASTED, " ").replace(/\s+/g, " ").trim() };
}
