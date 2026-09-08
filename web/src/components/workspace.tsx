"use client";

/**
 * What is open on the canvas, and whether it is stale.
 *
 * Lives above the rail, the canvas and the chat because all three touch it:
 * the rail opens tabs, the canvas draws them, and the chat invalidates them
 * when the agent changes a dashboard.
 */

import { useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TablePreview } from "@/lib/api";
import { readLink } from "@/lib/links";

export type Tab =
  | { kind: "table"; id: string; database: string; table: string; label: string }
  | { kind: "dashboard"; id: string; dashboardId: string; label: string }
  | { kind: "proposal"; id: string; proposalId: string; label: string };

/** A chart someone asked to see whole, by following a link to it. */
type PanelFocus = { dashboardId: string; panelId: string };

/**
 * Something the analyst has started making and has not finished.
 *
 * The chat learns about these from the stream — the agent's tool call is
 * announced with the shape of what it will produce, seconds before the query
 * behind it returns — and the canvas draws a placeholder of that shape. So a
 * dashboard fills in cell by cell instead of appearing all at once, and the
 * layout it settles into is the one it keeps.
 *
 * `token` is the tool call's own id, which is how the stream says it is done.
 */
export type Build = {
  token: string;
  kind: "panel" | "still";
  dashboardId?: string;
  proposalId?: string;
  /** Set when an existing chart is being rewritten rather than added. */
  panelId?: string;
  title?: string;
  chart?: string;
  width?: number;
  height?: number;
  /**
   * The panel this became, once the call has returned. The placeholder stays
   * up until a fetch brings that panel back, so the handoff is one render —
   * dropping it when the call returns leaves the cell empty for as long as the
   * refetch takes, which is long enough to see.
   */
  landed?: string;
};

type WorkspaceValue = {
  tabs: Tab[];
  activeId: string | null;
  openTable: (database: string, table: string) => void;
  openDashboard: (dashboardId: string, title: string) => void;
  openProposal: (proposalId: string, title: string) => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  cached: (id: string) => TablePreview | undefined;
  cache: (id: string, preview: TablePreview) => void;
  /** Bumped when a dashboard changes underneath us; panels refetch on it. */
  revision: number;
  touchDashboard: (dashboardId: string) => void;
  touchProposal: (proposalId: string) => void;
  /** What the analyst is making right now, for the canvas to hold space for. */
  building: Build[];
  startBuild: (build: Build) => void;
  finishBuild: (token: string, panelId?: string) => void;
  /** A turn ended, however it ended. Nothing is still on its way. */
  clearBuilds: () => void;
  /** A turn is in flight somewhere, so an empty canvas may not stay empty. */
  working: boolean;
  turnStarted: () => void;
  turnEnded: () => void;
  /**
   * Open what a `/studio?…` path points at. False if the path is not one of
   * ours, which is the caller's cue to let the browser have the click.
   */
  follow: (href: string) => boolean;
  /** The panel a followed link asked for, until the dashboard takes it. */
  panelFocus: PanelFocus | null;
  clearPanelFocus: () => void;
};

/**
 * What a canvas path points at: a tab, and maybe one chart inside it.
 *
 * The paths are written by whoever knows the generated id — the tools that
 * did the writing (`streamlens/links.py`), or a panel's copy button — and
 * read back through one parser, so all of them land the same way.
 */
function pointedAt(
  href: string,
): { tab: Tab; panel: PanelFocus | null } | null {
  const ref = readLink(href);
  if (!ref) return null;

  if (ref.kind === "dashboard") {
    return {
      tab: {
        kind: "dashboard",
        id: `dashboard:${ref.id}`,
        dashboardId: ref.id,
        label: ref.id,
      },
      panel: ref.panelId ? { dashboardId: ref.id, panelId: ref.panelId } : null,
    };
  }
  return {
    tab: {
      kind: "proposal",
      id: `proposal:${ref.id}`,
      proposalId: ref.id,
      label: ref.id,
    },
    // A proposal's charts are part of its argument and do not expand, so a
    // panel in the path is context for the chat rather than a view to open.
    panel: null,
  };
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (value === null) {
    throw new Error("useWorkspace must be used inside <Workspace>");
  }
  return value;
}

export function Workspace({ children }: { children: React.ReactNode }) {
  // A path that arrived from outside: pasted, bookmarked, or one of the
  // analyst's links opened in a second browser tab. Read as initial state
  // rather than in an effect, so the server and the first client render agree
  // on which tab is open — the rail is streamed in, and it hydrates against
  // whatever the workspace says by then.
  const landed = pointedAt(`/studio?${useSearchParams()}`);

  const [tabs, setTabs] = useState<Tab[]>(() => (landed ? [landed.tab] : []));
  const [activeId, setActiveId] = useState<string | null>(
    () => landed?.tab.id ?? null,
  );
  const [revision, setRevision] = useState(0);
  const [building, setBuilding] = useState<Build[]>([]);
  // Counted rather than flagged: two conversation tabs can be working at once,
  // and the first one to finish must not tell the canvas that nothing is.
  const [turns, setTurns] = useState(0);
  const [panelFocus, setPanelFocus] = useState<PanelFocus | null>(
    () => landed?.panel ?? null,
  );

  // Rows already fetched, so switching back to a tab is instant and does not
  // hit the warehouse again.
  const previews = useRef(new Map<string, TablePreview>());

  const open = useCallback((tab: Tab) => {
    setTabs((current) =>
      current.some((t) => t.id === tab.id) ? current : [...current, tab],
    );
    setActiveId(tab.id);
  }, []);

  const openTable = useCallback(
    (database: string, table: string) =>
      open({
        kind: "table",
        id: `table:${database}.${table}`,
        database,
        table,
        label: table,
      }),
    [open],
  );

  const openDashboard = useCallback(
    (dashboardId: string, title: string) =>
      open({
        kind: "dashboard",
        id: `dashboard:${dashboardId}`,
        dashboardId,
        label: title,
      }),
    [open],
  );

  const openProposal = useCallback(
    (proposalId: string, title: string) =>
      open({
        kind: "proposal",
        id: `proposal:${proposalId}`,
        proposalId,
        label: title,
      }),
    [open],
  );

  const closeTab = useCallback((id: string) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      if (index === -1) return current;

      const remaining = current.filter((tab) => tab.id !== id);
      setActiveId((active) => {
        if (active !== id) return active;
        // Fall back to the neighbour on the left, the way an editor does.
        const next = remaining[index - 1] ?? remaining[0];
        return next?.id ?? null;
      });
      return remaining;
    });
  }, []);

  /**
   * The agent changed a dashboard. Open it if it is not already open — a
   * dashboard the user cannot see was not really built — and mark everything
   * stale so the panels reload.
   */
  const touchDashboard = useCallback(
    (dashboardId: string) => {
      const id = `dashboard:${dashboardId}`;
      setTabs((current) =>
        current.some((t) => t.id === id)
          ? current
          : [...current, { kind: "dashboard", id, dashboardId, label: dashboardId }],
      );
      setActiveId(id);
      setRevision((n) => n + 1);
    },
    [],
  );

  /**
   * The agent wrote a proposal. Same contract as a dashboard: open it if it
   * is not already open, because a one-sheet nobody can see was not really
   * written, and bump the revision so the rail picks it up.
   */
  const touchProposal = useCallback((proposalId: string) => {
    const id = `proposal:${proposalId}`;
    setTabs((current) =>
      current.some((t) => t.id === id)
        ? current
        : [...current, { kind: "proposal", id, proposalId, label: proposalId }],
    );
    setActiveId(id);
    setRevision((n) => n + 1);
  }, []);

  /**
   * The analyst has started making something. Open what it is going onto, for
   * the same reason a finished one opens it: a chart being built somewhere the
   * user cannot see is indistinguishable from nothing happening. No revision
   * bump — nothing has changed yet, and refetching now would replay every
   * query on the board to learn that.
   */
  const startBuild = useCallback(
    (build: Build) => {
      setBuilding((current) =>
        current.some((b) => b.token === build.token)
          ? current
          : [...current, build],
      );
      if (build.dashboardId) {
        open({
          kind: "dashboard",
          id: `dashboard:${build.dashboardId}`,
          dashboardId: build.dashboardId,
          label: build.dashboardId,
        });
      } else if (build.proposalId) {
        open({
          kind: "proposal",
          id: `proposal:${build.proposalId}`,
          proposalId: build.proposalId,
          label: build.proposalId,
        });
      }
    },
    [open],
  );

  /**
   * A call came back. If it says which panel it made, the placeholder is kept
   * and marked, for the canvas to retire when it has that panel in hand;
   * otherwise there is nothing to wait for and it goes now.
   */
  const finishBuild = useCallback((token: string, panelId?: string) => {
    setBuilding((current) =>
      panelId
        ? current.map((b) => (b.token === token ? { ...b, landed: panelId } : b))
        : current.filter((b) => b.token !== token),
    );
  }, []);

  /**
   * Nothing is coming any more. Called when a turn ends however it ends,
   * because a turn that failed half way through has left placeholders for
   * charts that will never arrive, and a shimmer that never resolves is worse
   * than no shimmer at all.
   */
  const clearBuilds = useCallback(() => setBuilding([]), []);

  const turnStarted = useCallback(() => setTurns((n) => n + 1), []);
  const turnEnded = useCallback(() => setTurns((n) => Math.max(0, n - 1)), []);

  /**
   * Follow a link to something on this canvas — the analyst's, or one the
   * user copied off a panel and pasted back.
   *
   * Opening a tab rather than navigating: the canvas is one page, and a
   * reload would throw away every other tab to show this one. Somewhere
   * else's `/studio` is somewhere else, so an absolute link is only ours if
   * the origin says so.
   */
  const follow = useCallback(
    (href: string): boolean => {
      if (/^\w+:/.test(href) && !href.startsWith(window.location.origin)) {
        return false;
      }
      const target = pointedAt(href);
      if (!target) return false;

      open(target.tab);
      setPanelFocus(target.panel);
      return true;
    },
    [open],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({
      tabs,
      activeId,
      openTable,
      openDashboard,
      openProposal,
      closeTab,
      activate: setActiveId,
      cached: (id) => previews.current.get(id),
      cache: (id, preview) => {
        previews.current.set(id, preview);
      },
      revision,
      touchDashboard,
      touchProposal,
      building,
      startBuild,
      finishBuild,
      clearBuilds,
      working: turns > 0,
      turnStarted,
      turnEnded,
      follow,
      panelFocus,
      clearPanelFocus: () => setPanelFocus(null),
    }),
    [
      tabs,
      activeId,
      openTable,
      openDashboard,
      openProposal,
      closeTab,
      revision,
      touchDashboard,
      touchProposal,
      building,
      startBuild,
      finishBuild,
      clearBuilds,
      turns,
      turnStarted,
      turnEnded,
      follow,
      panelFocus,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
