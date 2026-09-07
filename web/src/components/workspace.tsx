"use client";

/**
 * What is open on the canvas, and whether it is stale.
 *
 * Lives above the rail, the canvas and the chat because all three touch it:
 * the rail opens tabs, the canvas draws them, and the chat invalidates them
 * when the agent changes a dashboard.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TablePreview } from "@/lib/api";

export type Tab =
  | { kind: "table"; id: string; database: string; table: string; label: string }
  | { kind: "dashboard"; id: string; dashboardId: string; label: string };

type WorkspaceValue = {
  tabs: Tab[];
  activeId: string | null;
  openTable: (database: string, table: string) => void;
  openDashboard: (dashboardId: string, title: string) => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  cached: (id: string) => TablePreview | undefined;
  cache: (id: string, preview: TablePreview) => void;
  /** Bumped when a dashboard changes underneath us; panels refetch on it. */
  revision: number;
  touchDashboard: (dashboardId: string) => void;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (value === null) {
    throw new Error("useWorkspace must be used inside <Workspace>");
  }
  return value;
}

export function Workspace({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

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

  const value = useMemo<WorkspaceValue>(
    () => ({
      tabs,
      activeId,
      openTable,
      openDashboard,
      closeTab,
      activate: setActiveId,
      cached: (id) => previews.current.get(id),
      cache: (id, preview) => {
        previews.current.set(id, preview);
      },
      revision,
      touchDashboard,
    }),
    [tabs, activeId, openTable, openDashboard, closeTab, revision, touchDashboard],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
