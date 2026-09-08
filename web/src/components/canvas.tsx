"use client";

/**
 * The canvas: one tab per open table or dashboard, the active one drawn.
 */

import { useEffect, useState } from "react";

import type { TablePreview } from "@/lib/api";
import { commas } from "@/lib/format";
import { DashboardView } from "@/components/dashboard";
import { ProposalView } from "@/components/proposal";
import { Connecting } from "@/components/spinner";
import { useWorkspace } from "@/components/workspace";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (Array.isArray(value)) return value.length ? `[${value.join(", ")}]` : "[]";
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

function isNumeric(type: string): boolean {
  return /^(Nullable\()?(U?Int|Float|Decimal)/.test(type);
}

function TableGrid({ preview }: { preview: TablePreview }) {
  const shown = preview.rows.length;

  return (
    <div className="grid-wrap">
      <div className="grid-bar">
        <span className="grid-title">
          {preview.database}.{preview.table}
        </span>
        <span className="grid-meta">
          {preview.engine} · {preview.columns.length} columns ·{" "}
          {commas(preview.total_rows)} rows
          {shown < preview.total_rows && ` · showing first ${commas(shown)}`}
        </span>
      </div>

      <div className="grid-scroll">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="grid-gutter" />
              {preview.columns.map((column) => (
                <th key={column.name}>
                  <span className="grid-col">{column.name}</span>
                  <span className="grid-type">{column.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, index) => (
              <tr key={index}>
                <td className="grid-gutter">{index + 1}</td>
                {row.map((value, column) => (
                  <td
                    key={column}
                    className={
                      isNumeric(preview.columns[column]?.type ?? "")
                        ? "is-number"
                        : undefined
                    }
                  >
                    <span
                      className={value === null ? "is-null" : undefined}
                      title={cellText(value)}
                    >
                      {cellText(value)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {shown === 0 && (
          <p className="grid-empty">
            No rows. The table exists and its schema is above.
          </p>
        )}
      </div>
    </div>
  );
}

function TableTab({ database, table }: { database: string; table: string }) {
  const { cached, cache } = useWorkspace();
  const id = `table:${database}.${table}`;
  const [preview, setPreview] = useState<TablePreview | undefined>(() =>
    cached(id),
  );
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (cached(id)) return;
    const ac = new AbortController();

    fetch(`/api/table/${database}/${table}?limit=200`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<TablePreview>;
      })
      .then((data) => {
        cache(id, data);
        setPreview(data);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setError(String(e));
      });

    return () => ac.abort();
  }, [id, database, table, cached, cache]);

  if (error) return <p className="canvas-error">{error}</p>;
  if (!preview) return <Connecting label={`Reading ${database}.${table}`} />;
  return <TableGrid preview={preview} />;
}

export function Canvas() {
  const { tabs, activeId, closeTab, activate } = useWorkspace();
  const active = tabs.find((tab) => tab.id === activeId);

  if (tabs.length === 0) {
    return (
      <div className="canvas-empty">
        <div className="canvas-empty-marks" aria-hidden>
          <i className="tone-yellow" />
          <i className="tone-blue" />
          <i className="tone-green" />
          <i className="tone-purple" />
        </div>
        <p>Get started by creating dashboards</p>
      </div>
    );
  }

  return (
    <div className="canvas">
      <div className="tabbar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab${tab.id === activeId ? " on" : ""}${
              tab.kind === "dashboard"
                ? " is-dash"
                : tab.kind === "proposal"
                  ? " is-proposal"
                  : ""
            }`}
            onClick={() => activate(tab.id)}
            role="tab"
            aria-selected={tab.id === activeId}
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && activate(tab.id)}
          >
            <span className="tab-name" title={tab.label}>
              {tab.kind === "dashboard" && <span className="tab-kind">▦</span>}
              {tab.kind === "proposal" && <span className="tab-kind">≡</span>}
              {tab.label}
            </span>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tab.id}`}
              onClick={(e) => {
                // Without this the click also selects the tab being closed.
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {active?.kind === "table" && (
        <TableTab
          key={active.id}
          database={active.database}
          table={active.table}
        />
      )}
      {active?.kind === "dashboard" && (
        <DashboardView key={active.id} dashboardId={active.dashboardId} />
      )}
      {active?.kind === "proposal" && (
        <ProposalView key={active.id} proposalId={active.proposalId} />
      )}
    </div>
  );
}
