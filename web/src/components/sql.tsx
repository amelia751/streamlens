"use client";

/**
 * A statement the analyst ran, and the rows it answered with.
 *
 * Folded, the line is the SELECT — that is the command. Opened, it is the
 * result of that command: a few of the rows, or the refusal. Expanding to
 * show the SQL again would be expanding to show what was already on the
 * line.
 */

import { useEffect, useState } from "react";

export type Ran = {
  label: string;
  rows?: number;
  problem?: string;
  done?: boolean;
  columns?: string[];
  sample?: unknown[][];
};

function outcome(ran: Ran): string {
  if (ran.problem) return "refused";
  if (!ran.done) return "running";
  if (ran.rows === undefined) return "ran";
  return `${ran.rows.toLocaleString()} ${ran.rows === 1 ? "row" : "rows"}`;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function SqlBlock({ query, ran }: { query: string; ran: Ran }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const first = query.replace(/\s+/g, " ").trim();
  const note = outcome(ran);
  const columns = ran.columns ?? [];
  const sample = ran.sample ?? [];
  const hasOut = Boolean(ran.problem || sample.length || (ran.done && !ran.problem));

  return (
    <div className={`sql${open ? " is-open" : ""}`}>
      <div className="sql-head">
        <button
          type="button"
          className="sql-open"
          aria-expanded={open}
          disabled={!hasOut}
          onClick={() => hasOut && setOpen((value) => !value)}
        >
          {hasOut ? (
            <span className="sql-chevron" aria-hidden>
              ›
            </span>
          ) : (
            <span className="sql-chevron is-empty" aria-hidden />
          )}
          <span className="sql-tag">SQL</span>
          <code className="sql-peek">{first}</code>
        </button>
        <span
          className={`sql-note${ran.problem ? " is-bad" : ""}${
            !ran.done && !ran.problem ? " is-running" : ""
          }`}
        >
          {note}
        </span>
        <button
          type="button"
          className={`sql-copy${copied ? " is-copied" : ""}`}
          aria-label={copied ? "Copied" : "Copy this query"}
          onClick={() => {
            navigator.clipboard?.writeText(query);
            setCopied(true);
          }}
        >
          {copied ? "✓" : "⧉"}
        </button>
      </div>

      {open && (
        <div className="sql-out">
          {ran.problem ? (
            <p className="sql-problem">{ran.problem}</p>
          ) : sample.length === 0 ? (
            <p className="sql-empty">No rows.</p>
          ) : (
            <div className="sql-scroll">
              <table className="sql-table">
                {columns.length > 0 && (
                  <thead>
                    <tr>
                      {columns.map((name) => (
                        <th key={name}>{name}</th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {sample.map((row, i) => (
                    <tr key={i}>
                      {(columns.length ? columns : row).map((_, j) => (
                        <td key={j}>{cell(row[j])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
