"use client";

/**
 * The rail is a mirror of the ClickHouse Cloud service, not a hand-written
 * menu. Dashboards and sources each keep their own pane so a long table
 * list cannot scroll the work off the screen.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  if (!vendor) return null;
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

function KindMark({ kind }: { kind: "storage" | "api" }) {
  return (
    <svg className="rail-kind" viewBox="0 0 16 16" aria-hidden>
      {kind === "storage" ? (
        <>
          <ellipse cx="8" cy="3.6" rx="5.2" ry="2" />
          <path d="M2.8 3.6v8.2c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2V3.6" />
          <path d="M2.8 7.4c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2" />
        </>
      ) : (
        <>
          <path d="M3 8h3.2M9.8 8H13" />
          <path d="M5.4 6.2 3 8l2.4 1.8M10.6 6.2 13 8l-2.4 1.8" />
          <rect x="6.1" y="5.4" width="3.8" height="5.2" rx="0.8" />
        </>
      )}
    </svg>
  );
}

function groupKind(source: Source): "storage" | "api" {
  if (source.id === "youtube-api" || source.mechanism === "API poll") {
    return "api";
  }
  return "storage";
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
        <KindMark kind={groupKind(source)} />
        <span className="rail-row-title">{source.label}</span>
        {warn && <i className="dot warn" title={source.state} />}
        <span className="rail-count">{compact(source.rows)}</span>
      </button>
      {open && (
        <div className="rail-children">
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
function useDashboards(initial: DashboardSummary[]): {
  dashboards: DashboardSummary[];
  drop: (id: string) => void;
  restore: (dashboard: DashboardSummary) => void;
} {
  const { revision } = useWorkspace();
  const [dashboards, setDashboards] = useState(initial);
  const gone = useRef(new Set<string>());

  useEffect(() => {
    setDashboards(initial.filter((d) => !gone.current.has(d.id)));
  }, [initial]);

  useEffect(() => {
    let dropped = false;
    fetch("/api/dashboards")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (dropped || !body) return;
        setDashboards(
          (body.dashboards ?? []).filter(
            (d: DashboardSummary) => !gone.current.has(d.id),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      dropped = true;
    };
  }, [revision]);

  return {
    dashboards,
    drop: (id: string) => {
      gone.current.add(id);
      setDashboards((list) => list.filter((d) => d.id !== id));
    },
    restore: (dashboard: DashboardSummary) => {
      gone.current.delete(dashboard.id);
      setDashboards((list) =>
        list.some((d) => d.id === dashboard.id) ? list : [dashboard, ...list],
      );
    },
  };
}

function Kebab() {
  return (
    <svg className="rail-kebab-icon" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="3.2" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="8" cy="12.8" r="1.25" />
    </svg>
  );
}

function ConfirmDelete({
  title,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return createPortal(
    <div
      className="confirm-scrim"
      role="presentation"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">Delete “{title}”?</h2>
        <p>This removes the dashboard and its panels. It cannot be undone.</p>
        {error && <p className="confirm-error">{error}</p>}
        <div className="confirm-actions">
          <button
            type="button"
            className="confirm-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-delete"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DashboardRow({
  dashboard,
  onDeleted,
  onRestore,
}: {
  dashboard: DashboardSummary;
  onDeleted: (id: string) => void;
  onRestore: (dashboard: DashboardSummary) => void;
}) {
  const { openDashboard, activeId, closeTab } = useWorkspace();
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const on = activeId === `dashboard:${dashboard.id}`;
  const panels = dashboard.panel_count;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  async function remove() {
    setBusy(true);
    setError(undefined);
    // Drop the tab first so in-flight panel queries abort and free the
    // connection the delete needs. Closing after the request is what made
    // the canvas sit on a half-dead dashboard while ClickHouse was busy.
    closeTab(`dashboard:${dashboard.id}`);
    try {
      const res = await fetch(`/api/dashboards/${dashboard.id}`, {
        method: "DELETE",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await res.text());
      onDeleted(dashboard.id);
      setConfirm(false);
    } catch (e) {
      onRestore(dashboard);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`rail-dash-row${on ? " on" : ""}`}>
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
      <div className="rail-kebab-wrap" ref={menu}>
        <button
          type="button"
          className={`rail-kebab${open ? " on" : ""}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Actions for ${dashboard.title}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          <Kebab />
        </button>
        {open && (
          <div className="rail-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="rail-menu-item is-danger"
              onClick={() => {
                setOpen(false);
                setConfirm(true);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {confirm && (
        <ConfirmDelete
          title={dashboard.title}
          busy={busy}
          error={error}
          onCancel={() => {
            if (busy) return;
            setConfirm(false);
            setError(undefined);
          }}
          onConfirm={remove}
        />
      )}
    </li>
  );
}

function DashboardList({
  dashboards,
  onDeleted,
  onRestore,
}: {
  dashboards: DashboardSummary[];
  onDeleted: (id: string) => void;
  onRestore: (dashboard: DashboardSummary) => void;
}) {
  if (dashboards.length === 0) {
    return <p className="rail-empty">Ask the analyst to build one.</p>;
  }

  return (
    <ul className="rail-dashes">
      {dashboards.map((dashboard) => (
        <DashboardRow
          key={dashboard.id}
          dashboard={dashboard}
          onDeleted={onDeleted}
          onRestore={onRestore}
        />
      ))}
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
  const { dashboards, drop, restore } = useDashboards(initialDashboards);

  return (
    <aside className="rail">
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
            <DashboardList
              dashboards={dashboards}
              onDeleted={drop}
              onRestore={restore}
            />
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
