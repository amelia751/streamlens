"use client";

/**
 * The rail is a mirror of the ClickHouse Cloud service, not a hand-written
 * menu. Every pipe, database, and table below came back from the instance
 * on this request.
 */

import { useEffect, useState } from "react";

import type { Database, DashboardSummary, Source, Warehouse } from "@/lib/api";
import { commas, compact, since } from "@/lib/format";
import { useWorkspace } from "@/components/workspace";

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

/** A table in the rail. Clicking it opens that table on the canvas. */
function Leaf({
  database,
  table,
  label,
  rows,
  state,
  tag,
  muted,
}: {
  database: string;
  table: string;
  label: string;
  rows: number;
  state?: string;
  tag?: string;
  muted?: boolean;
}) {
  const { openTable, activeId } = useWorkspace();
  const id = `table:${database}.${table}`;

  return (
    <button
      type="button"
      className={`rail-leaf${activeId === id ? " on" : ""}`}
      onClick={() => openTable(database, table)}
      title={`${id} — ${commas(rows)} rows`}
    >
      {state && <i className={stateClass(state)} />}
      <span className={`rail-leaf-name${muted ? " is-muted" : ""}`}>
        {label}
      </span>
      {tag && <span className="tag">{tag}</span>}
      <span className="rail-count">{compact(rows)}</span>
    </button>
  );
}

function stateClass(state: string): string {
  if (state === "Live") return "dot live";
  if (state === "Completed" || state === "Running") return "dot ok";
  if (state === "Failed" || state === "Mixed" || state === "Stopped") {
    return "dot warn";
  }
  return "dot";
}

function Group({
  title,
  note,
  count,
  state,
  tag,
  defaultOpen = false,
  children,
}: {
  title: string;
  note?: string;
  count: string;
  state?: string;
  tag?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rail-group">
      <button
        type="button"
        className="rail-row"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className={`rail-caret${open ? " open" : ""}`}>▶</span>
        {state && <i className={stateClass(state)} />}
        <span className="rail-row-main">
          <span className="rail-row-title">{title}</span>
          {note && <span className="rail-row-note">{note}</span>}
        </span>
        {tag && <span className="tag">{tag}</span>}
        <span className="rail-count">{count}</span>
      </button>
      {open && <div className="rail-children">{children}</div>}
    </div>
  );
}

function SourceGroup({ source }: { source: Source }) {
  const elapsed = useElapsed(source.last_sync);
  const note = elapsed ? `${source.detail} · synced ${elapsed}` : source.detail;

  return (
    <Group
      title={source.label}
      note={note}
      tag={source.mechanism}
      state={source.state}
      count={compact(source.rows)}
    >
      {source.streams.map((stream) => (
        <Leaf
          key={stream.name}
          database={stream.database}
          table={stream.table}
          label={stream.table}
          rows={stream.rows}
          state={stream.state}
        />
      ))}
    </Group>
  );
}

function DatabaseGroup({ database }: { database: Database }) {
  // Every ClickPipe destination carries a sibling table for rows it could
  // not parse. They are plumbing, so they are counted and not listed.
  const tables = database.tables.filter((t) => t.kind !== "errors");
  const errors = database.tables.length - tables.length;

  return (
    <Group
      title={database.name}
      note={`${database.table_count} tables · ${commas(database.rows)} rows`}
      count={compact(database.rows)}
    >
      {tables.map((table) => (
        <Leaf
          key={table.name}
          database={database.name}
          table={table.name}
          label={table.name}
          rows={table.rows}
          tag={table.kind === "view" ? "view" : undefined}
          muted={table.kind === "view"}
        />
      ))}
      {errors > 0 && (
        <p className="rail-note">+ {errors} ingestion error tables</p>
      )}
    </Group>
  );
}

/**
 * The dashboards that exist, refetched whenever the agent changes one so a
 * newly built dashboard appears in the rail without a reload.
 */
function DashboardList() {
  const { openDashboard, activeId, revision } = useWorkspace();
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);

  useEffect(() => {
    let dropped = false;
    fetch("/api/dashboards")
      .then((res) => (res.ok ? res.json() : { dashboards: [] }))
      .then((body) => !dropped && setDashboards(body.dashboards ?? []))
      .catch(() => undefined);
    return () => {
      dropped = true;
    };
  }, [revision]);

  return (
    <>
      <div className="rail-section">
        <h2>Dashboards</h2>
        <span>{dashboards.length}</span>
      </div>
      {dashboards.length === 0 ? (
        <p className="rail-note">None yet — ask the curator for one.</p>
      ) : (
        dashboards.map((dashboard) => (
          <button
            key={dashboard.id}
            type="button"
            className={`rail-leaf${
              activeId === `dashboard:${dashboard.id}` ? " on" : ""
            }`}
            onClick={() => openDashboard(dashboard.id, dashboard.title)}
            title={dashboard.description || dashboard.title}
          >
            <i className="dot live" />
            <span className="rail-leaf-name">{dashboard.title}</span>
            <span className="rail-count">{dashboard.panel_count}</span>
          </button>
        ))
      )}
    </>
  );
}

export function Sidebar({
  warehouse,
  error,
}: {
  warehouse: Warehouse | null;
  error?: string;
}) {
  const totalRows =
    warehouse?.databases.reduce((sum, db) => sum + db.rows, 0) ?? 0;

  return (
    <aside className="rail">
      <div className="rail-head">
        <p className="kicker">
          <i
            className={`dot${warehouse ? " live" : " warn"}`}
            aria-hidden
          />
          Warehouse
        </p>
        <p className="rail-sub">
          {warehouse
            ? `${warehouse.service.name} · v${warehouse.service.version}`
            : "not connected"}
        </p>
      </div>

      <nav className="rail-scroll">
        {error && (
          <div className="rail-error">
            <strong>Backend unreachable.</strong>
            <br />
            Start it with{" "}
            <code>uv run uvicorn streamlens.api:app --port 8000</code> from{" "}
            <code>backend/</code>.
          </div>
        )}

        <DashboardList />

        {warehouse && (
          <>
            <div className="rail-section">
              <h2>Sources</h2>
              <span>{warehouse.sources.length}</span>
            </div>
            {warehouse.sources.map((source) => (
              <SourceGroup key={source.id} source={source} />
            ))}

            <div className="rail-section">
              <h2>Databases</h2>
              <span>{compact(totalRows)} rows</span>
            </div>
            {warehouse.databases.map((database) => (
              <DatabaseGroup key={database.name} database={database} />
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
