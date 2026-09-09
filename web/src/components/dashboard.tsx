"use client";

/**
 * A dashboard on the canvas: panels on a twelve-column grid, any one of
 * which can be expanded to fill the canvas and put back.
 */

import { useCallback, useEffect, useState } from "react";

import type { Dashboard, Panel } from "@/lib/api";
import { packRows } from "@/lib/layout";
import { dashboardLink } from "@/lib/links";
import { BoardSkeleton, PanelCard, PanelPlaceholder } from "@/components/panel";
import { Connecting } from "@/components/spinner";
import { useWorkspace, type Build } from "@/components/workspace";

/**
 * A chart on its way, standing in the grid as if it were already a panel.
 *
 * Packed with the real ones rather than appended after them, because the
 * packer scales each row to fill twelve columns: a placeholder laid out on the
 * raw width the analyst asked for would land in a different cell than the
 * chart that replaces it, and the board would jump exactly when it stopped
 * waiting. Same input, same arithmetic, same cell.
 */
type Pending = { id: string; width: number; height: number; build: Build };

type Cell = Panel | Pending;

function isPending(cell: Cell): cell is Pending {
  return "build" in cell;
}

/**
 * What a panel would have to change for its rows to be worth fetching again.
 *
 * The alternative — refetching everything whenever the dashboard changes —
 * costs one warehouse query per panel per added panel, and shows it: a board
 * of six charts blanks and redraws each time the analyst adds a seventh.
 */
function dataVersion(panel: Panel): string {
  return `${panel.query}|${JSON.stringify(panel.spec)}`;
}

export function DashboardView({ dashboardId }: { dashboardId: string }) {
  const { revision, panelFocus, clearPanelFocus, building, working } =
    useWorkspace();
  // One piece of state, so a reload replaces the old panels and the old
  // error together rather than briefly showing both.
  const [state, setState] = useState<{
    dashboard?: Dashboard;
    error?: string;
  }>({});
  const { dashboard, error } = state;
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();

    fetch(`/api/dashboards/${dashboardId}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<Dashboard>;
      })
      .then((body) => setState({ dashboard: body }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setState({ error: String(e) });
      });

    return () => ac.abort();
  }, [dashboardId, revision]);

  /**
   * A link that asked for one chart, which outranks what this view last had
   * expanded — following a link to a panel is a request to see that panel.
   *
   * Read rather than copied into local state, and dropped by the first thing
   * the user does with a panel themselves. So it survives a trip to another
   * tab, which a chart nobody put away should, and it stops mattering the
   * moment they shrink it.
   */
  const requested =
    panelFocus?.dashboardId === dashboardId ? panelFocus.panelId : null;
  const shown = requested ?? expanded;

  const toggle = useCallback(
    (id: string) => {
      setExpanded(shown === id ? null : id);
      clearPanelFocus();
    },
    [shown, clearPanelFocus],
  );

  // Escape is what people reach for to get out of an expanded panel.
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setExpanded(null);
      clearPanelFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, clearPanelFocus]);

  if (error) return <p className="canvas-error">{error}</p>;
  if (!dashboard) return <Connecting />;

  // Charts the analyst has started on this board. The ones that name a panel
  // are rewrites of something already drawn, and mark that chart instead of
  // taking a cell of their own. A finished one keeps its cell until the panel
  // it became is in the fetched board, so the placeholder and the chart never
  // both miss.
  const here = new Set(dashboard.panels.map((p) => p.id));
  const coming = building.filter(
    (b) =>
      b.kind === "panel" &&
      b.dashboardId === dashboardId &&
      !(b.landed && here.has(b.landed)),
  );
  const rewriting = new Set(coming.map((b) => b.panelId).filter(Boolean));

  // Widths are the analyst's sense of what matters, not a literal span;
  // the grid decides the rest.
  const cells = packRows<Cell>([
    ...dashboard.panels,
    ...coming
      .filter((b) => !b.panelId)
      .map((b) => ({
        id: b.token,
        width: b.width ?? 6,
        height: b.height ?? 1,
        build: b,
      })),
  ]);
  const open = cells.find((c) => !isPending(c) && c.id === shown) as
    | Panel
    | undefined;

  return (
    <div className="dash">
      <header className="dash-head">
        <h2 className="dash-title">{dashboard.title}</h2>
        {dashboard.description && (
          <p className="dash-note">{dashboard.description}</p>
        )}
      </header>

      {cells.length === 0 ? (
        // A board the analyst has just created is empty for a few seconds
        // while it writes the first query. Telling the user to ask for a panel
        // in the middle of getting one is the wrong instruction.
        working ? (
          <BoardSkeleton />
        ) : (
          <p className="canvas-waiting">No panels yet. Ask the analyst for one.</p>
        )
      ) : open ? (
        <PanelCard
          key={open.id}
          panel={open}
          dataUrl={`/api/dashboards/${dashboardId}/panels/${open.id}`}
          reference={dashboardLink(dashboardId, open.id)}
          expanded
          onToggle={() => toggle(open.id)}
          reloadKey={dataVersion(open)}
          busy={rewriting.has(open.id)}
        />
      ) : (
        <div className="dash-grid">
          {cells.map((cell) =>
            isPending(cell) ? (
              <PanelPlaceholder
                key={cell.id}
                title={cell.build.title}
                chart={cell.build.chart}
                width={cell.width}
                height={cell.height}
              />
            ) : (
              <PanelCard
                key={cell.id}
                panel={cell}
                dataUrl={`/api/dashboards/${dashboardId}/panels/${cell.id}`}
                reference={dashboardLink(dashboardId, cell.id)}
                expanded={false}
                onToggle={() => toggle(cell.id)}
                reloadKey={dataVersion(cell)}
                busy={rewriting.has(cell.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
