"use client";

/**
 * A dashboard on the canvas: panels on a twelve-column grid, any one of
 * which can be expanded to fill the canvas and put back.
 */

import { useCallback, useEffect, useState } from "react";

import type { Dashboard } from "@/lib/api";
import { packRows } from "@/lib/layout";
import { PanelCard } from "@/components/panel";
import { useWorkspace } from "@/components/workspace";

export function DashboardView({ dashboardId }: { dashboardId: string }) {
  const { revision } = useWorkspace();
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

  // Escape is what people reach for to get out of an expanded panel.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const toggle = useCallback(
    (id: string) => setExpanded((current) => (current === id ? null : id)),
    [],
  );

  if (error) return <p className="canvas-error">{error}</p>;
  if (!dashboard) return <p className="canvas-waiting">Loading dashboard…</p>;

  // Widths are the analyst's sense of what matters, not a literal span;
  // the grid decides the rest.
  const panels = packRows(dashboard.panels);
  const open = panels.find((p) => p.id === expanded);

  return (
    <div className="dash">
      <header className="dash-head">
        <h2 className="dash-title">{dashboard.title}</h2>
        {dashboard.description && (
          <p className="dash-note">{dashboard.description}</p>
        )}
      </header>

      {panels.length === 0 ? (
        <p className="canvas-waiting">
          No panels yet. Ask the analyst for one.
        </p>
      ) : open ? (
        <PanelCard
          key={open.id}
          panel={open}
          dataUrl={`/api/dashboards/${dashboardId}/panels/${open.id}`}
          expanded
          onToggle={() => toggle(open.id)}
          reloadKey={revision}
        />
      ) : (
        <div className="dash-grid">
          {panels.map((panel) => (
            <PanelCard
              key={panel.id}
              panel={panel}
              dataUrl={`/api/dashboards/${dashboardId}/panels/${panel.id}`}
              expanded={false}
              onToggle={() => toggle(panel.id)}
              reloadKey={revision}
            />
          ))}
        </div>
      )}
    </div>
  );
}
