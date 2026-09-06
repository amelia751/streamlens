"use client";

/**
 * Sortable, paged table.
 *
 * Separate from DataTable rather than an extension of it: DataTable takes
 * `render` callbacks and is called from server components, where functions
 * cannot cross the boundary. This one is only ever used from inside a client
 * component, so it can hold sort state and still take renderers.
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export type SortColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  render?: (r: Record<string, unknown>) => React.ReactNode;
};

type Dir = "asc" | "desc";

function compare(a: unknown, b: unknown) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), "en");
}

function rowKey(
  r: Record<string, unknown>,
  columns: SortColumn[],
  i: number,
) {
  return `${columns.map((c) => String(r[c.key] ?? "")).join("\u001f")}:${i}`;
}

export function SortableTable({
  columns,
  rows,
  initialSort,
  initialDir = "desc",
  pageSize = 25,
  empty = "No rows match these filters.",
}: {
  columns: SortColumn[];
  rows: Record<string, unknown>[];
  initialSort?: string;
  initialDir?: Dir;
  pageSize?: number;
  empty?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? columns[0].key);
  const [dir, setDir] = useState<Dir>(initialDir);
  const [shown, setShown] = useState(pageSize);

  const sorted = useMemo(() => {
    const out = [...rows].sort((x, y) => compare(x[sort], y[sort]));
    return dir === "desc" ? out.reverse() : out;
  }, [rows, sort, dir]);

  if (!rows.length) return <p className="empty">{empty}</p>;

  const visible = sorted.slice(0, shown);

  function toggle(key: string) {
    if (key === sort) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setDir("desc");
    }
    setShown(pageSize);
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => {
                const on = c.key === sort;
                const can = c.sortable !== false;
                return (
                  <th
                    key={c.key}
                    onClick={can ? () => toggle(c.key) : undefined}
                    style={{
                      textAlign: c.align === "right" ? "right" : "left",
                      cursor: can ? "pointer" : "default",
                      userSelect: "none",
                      color: on ? "var(--ink)" : undefined,
                      whiteSpace: "nowrap",
                    }}
                    title={can ? `Sort by ${c.label}` : undefined}
                  >
                    {c.label}
                    {can && (
                      <span
                        style={{
                          marginLeft: 4,
                          opacity: on ? 1 : 0.25,
                          fontSize: "0.7em",
                        }}
                      >
                        {on ? (dir === "asc" ? "▲" : "▼") : "▼"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {visible.map((r, i) => (
                <motion.tr
                  key={rowKey(r, columns, i)}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        textAlign: c.align === "right" ? "right" : "left",
                      }}
                    >
                      {c.render ? c.render(r) : String(r[c.key] ?? "")}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {shown < sorted.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + pageSize * 2)}
          className="mt-3 w-full rounded-lg py-2"
          style={{
            border: "1px solid var(--line)",
            background: "var(--paper)",
            color: "var(--muted)",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Show more — {sorted.length - shown} remaining
        </button>
      )}
    </div>
  );
}
