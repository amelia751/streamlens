"use client";

// Temporary: renders every gallery panel at a readable size, with no rail
// or chat in the way, so each chart type can be checked on its own.

import { useEffect, useState } from "react";

import type { Dashboard } from "@/lib/api";
import { PanelCard } from "@/components/panel";
import { Connecting } from "@/components/spinner";

export default function GalleryPreview() {
  const [dashboard, setDashboard] = useState<Dashboard>();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/api/dashboards/chart-gallery")
      .then(async (r) => {
        // A 404 still has a JSON body, and rendering that as a dashboard is
        // how this page used to crash instead of saying what was wrong.
        if (!r.ok) throw new Error(String(r.status));
        setDashboard(await r.json());
      })
      .catch(() => setMissing(true));
  }, []);

  if (missing) {
    return (
      <p className="canvas-waiting">
        No <code>chart-gallery</code> dashboard in the warehouse.
      </p>
    );
  }
  if (!dashboard) return <Connecting />;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        overflowY: "auto",
        padding: 20,
        background: "#fff",
      }}
    >
      {dashboard.panels.map((panel) => (
        <div key={panel.id} style={{ height: 420, marginBottom: 22 }}>
          <div className="dash-grid" style={{ height: "100%" }}>
            <PanelCard
              panel={{ ...panel, width: 12, height: 1 }}
              dataUrl={`/api/dashboards/chart-gallery/panels/${panel.id}`}
              expanded={false}
              onToggle={() => undefined}
              reloadKey={0}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
