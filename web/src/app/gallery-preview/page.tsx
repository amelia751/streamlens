"use client";

// Temporary: renders every gallery panel at a readable size, with no rail
// or chat in the way, so each chart type can be checked on its own.

import { useEffect, useState } from "react";

import type { Dashboard } from "@/lib/api";
import { PanelCard } from "@/components/panel";

export default function GalleryPreview() {
  const [dashboard, setDashboard] = useState<Dashboard>();

  useEffect(() => {
    fetch("/api/dashboards/chart-gallery")
      .then((r) => r.json())
      .then(setDashboard)
      .catch(() => undefined);
  }, []);

  if (!dashboard) return <p style={{ padding: 24 }}>Loading…</p>;

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
