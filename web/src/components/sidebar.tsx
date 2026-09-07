"use client";

/**
 * The rail is a mirror of the ClickHouse Cloud service, not a hand-written
 * menu. Dashboards and sources each keep their own pane so a long table
 * list cannot scroll the work off the screen.
 */

import { useEffect, useState } from "react";

import type {
  DashboardSummary,
  Source,
  SourceVendor,
  Warehouse,
} from "@/lib/api";
import { commas, compact, since } from "@/lib/format";
import { useWorkspace } from "@/components/workspace";
import type { Tone } from "@/lib/theme";

function sourceTone(source: Source): Tone {
  if (source.id === "youtube-api") return "teal";
  if (source.vendor === "gcs") return "green";
  if (source.vendor === "s3") return "yellow";
  if (source.vendor === "azure") return "blue";
  if (source.mechanism === "ClickPipe") return "green";
  return "gray";
}

function VendorMark({ vendor }: { vendor?: SourceVendor | null }) {
  if (!vendor) return <i className="swatch" aria-hidden />;
  return (
    <img
      className="rail-vendor"
      src={`/vendors/${vendor}.svg`}
      alt=""
      width={16}
      height={16}
    />
  );
}

/**
 * "2h ago", resolved after mount.
 *
 * The elapsed time is a different number on the server than in the browser
 * a moment later, so it cannot be part of the server-rendered markup.
 */
function useElapsed(iso?: string | null): string | undefined {
  const [text, setText] = useState<string>();

  useEffect(() => {
    if (!iso) return;
    const tick = () => setText(since(iso));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [iso]);

  return text;
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className={`rail-caret${open ? " open" : ""}`}
      viewBox="0 0 10 10"
      aria-hidden
    >
      <path
        d="M3.25 1.75 L7.25 5 L3.25 8.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function provenance(source: Source, elapsed?: string): string {
  if (source.id === "youtube-api") {
    return elapsed ? `API poll · ${elapsed}` : "API poll";
  }
  if (source.vendor === "gcs") return "GCS · ClickPipe";
  if (source.vendor === "s3") return "S3 · ClickPipe";
  if (source.vendor === "azure") return "Azure · ClickPipe";
  if (source.mechanism === "ClickPipe") return "ClickPipe";
  return source.mechanism;
}

function isUnhealthy(state?: string): boolean {
  return state === "Failed" || state === "Mixed" || state === "Stopped";
}

/** A table in the rail. Clicking it opens that table on the canvas. */
function Leaf({
  database,
  table,
  label,
  rows,
  vendor,
  muted,
}: {
  database: string;
  table: string;
  label?: string;
  rows: number;
  vendor?: SourceVendor | null;
  muted?: boolean;
}) {
  const { openTable, activeId } = useWorkspace();
  const id = `table:${database}.${table}`;

  return (
    <button
      type="button"
      className={`rail-leaf${activeId === id ? " on" : ""}`}
      onClick={() => openTable(database, table)}
      title={`${database}.${table} — ${commas(rows)} rows`}
    >
      {vendor ? <VendorMark vendor={vendor} /> : null}
      <span className={`rail-leaf-name${muted ? " is-muted" : ""}`}>
        {label ?? table}
      </span>
      <span className="rail-count">{compact(rows)}</span>
    </button>
  );
}

function SourceGroup({ source }: { source: Source }) {
  const { activeId } = useWorkspace();
  const elapsed = useElapsed(source.last_sync);
  const containsActive = source.streams.some(
    (stream) => activeId === `table:${stream.database}.${stream.table}`,
  );
  const [open, setOpen] = useState(
    containsActive || source.mechanism === "ClickPipe",
  );

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  const line = provenance(source, elapsed);
  const warn = isUnhealthy(source.state);
  const tone = sourceTone(source);

  return (
    <div className={`rail-group tone-${tone}`}>
      <button
        type="button"
        className="rail-row"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={`${source.detail}${elapsed ? ` · synced ${elapsed}` : ""}`}
      >
        <Caret open={open} />
        <VendorMark vendor={source.vendor} />
        <span className="rail-row-title">{source.label}</span>
        {warn && <i className="dot warn" title={source.state} />}
        <span className="rail-count">{compact(source.rows)}</span>
      </button>
      {open && (
        <div className="rail-children">
          <p className="rail-chip">{line}</p>
          {source.streams.map((stream) => (
            <Leaf
              key={`${stream.database}.${stream.table}`}
              database={stream.database}
              table={stream.table}
              label={stream.name}
              vendor={source.vendor}
              rows={stream.rows}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Seeded from the server, then refetched whenever the agent changes one so a
 * newly built dashboard appears in the rail without a reload.
 */
function useDashboards(initial: DashboardSummary[]): DashboardSummary[] {
  const { revision } = useWorkspace();
  const [dashboards, setDashboards] = useState(initial);

  useEffect(() => {
    setDashboards(initial);
  }, [initial]);

  useEffect(() => {
    let dropped = false;
    fetch("/api/dashboards")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (dropped || !body) return;
        setDashboards(body.dashboards ?? []);
      })
      .catch(() => undefined);
    return () => {
      dropped = true;
    };
  }, [revision]);

  return dashboards;
}

function DashboardList({ dashboards }: { dashboards: DashboardSummary[] }) {
  const { openDashboard, activeId } = useWorkspace();

  if (dashboards.length === 0) {
    return <p className="rail-empty">Ask the curator to build one.</p>;
  }

  return (
    <ul className="rail-dashes">
      {dashboards.map((dashboard) => {
        const on = activeId === `dashboard:${dashboard.id}`;
        const panels = dashboard.panel_count;
        return (
          <li key={dashboard.id}>
            <button
              type="button"
              className={`rail-dash${on ? " on" : ""}`}
              onClick={() => openDashboard(dashboard.id, dashboard.title)}
              title={dashboard.description || dashboard.title}
            >
              <span className="rail-dash-title">{dashboard.title}</span>
              {panels > 0 && (
                <span className="rail-badge" aria-label={`${panels} panels`}>
                  {panels}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({
  warehouse,
  dashboards: initialDashboards,
  error,
}: {
  warehouse: Warehouse | null;
  dashboards: DashboardSummary[];
  error?: string;
}) {
  const dashboards = useDashboards(initialDashboards);
  const totalRows =
    warehouse?.databases.reduce((sum, db) => sum + db.rows, 0) ?? 0;

  return (
    <aside className="rail">
      <div className="rail-head">
        <p className="rail-brand">
          <i className="swatch tone-purple" aria-hidden />
          Studio
        </p>
        <p className="rail-sub">
          <i
            className={`dot${warehouse ? " live" : " warn"}`}
            aria-hidden
          />
          {warehouse ? `${compact(totalRows)} rows` : "not connected"}
        </p>
      </div>

      {error && (
        <div className="rail-error">
          <strong>Backend unreachable.</strong>
          <br />
          Start it with{" "}
          <code>uv run uvicorn streamlens.api:app --port 8000</code> from{" "}
          <code>backend/</code>.
        </div>
      )}

      <div className="rail-panes">
        <section className="rail-pane is-dashboards">
          <h2 className="rail-label">Dashboards</h2>
          <div className="rail-pane-body">
            <DashboardList dashboards={dashboards} />
          </div>
        </section>

        <section className="rail-pane is-sources">
          <h2 className="rail-label">Sources</h2>
          <div className="rail-pane-body">
            {warehouse && warehouse.sources.length > 0 ? (
              warehouse.sources.map((source) => (
                <SourceGroup key={source.id} source={source} />
              ))
            ) : (
              <p className="rail-empty">
                {warehouse ? "No sources yet." : "Warehouse not connected."}
              </p>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
