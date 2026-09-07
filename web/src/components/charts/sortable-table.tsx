"use client";

/**
 * Sortable table.
 *
 * Separate from DataTable rather than an extension of it: DataTable takes
 * `render` callbacks and is called from server components, where functions
 * cannot cross the boundary. This one is only ever used from inside a client
 * component, so it can hold sort state and still take renderers.
 *
 * The body scrolls inside a fixed viewport so a thousand-row board does not
 * stretch the page. The header stays put.
 */
import { useMemo, useState } from "react";

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
  empty = "No rows match these filters.",
  maxHeight = "22rem",
}: {
  columns: SortColumn[];
  rows: Record<string, unknown>[];
  initialSort?: string;
  initialDir?: Dir;
  empty?: string;
  maxHeight?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? columns[0].key);
  const [dir, setDir] = useState<Dir>(initialDir);

  const sorted = useMemo(() => {
    const out = [...rows].sort((x, y) => compare(x[sort], y[sort]));
    return dir === "desc" ? out.reverse() : out;
  }, [rows, sort, dir]);

  if (!rows.length) return <p className="empty">{empty}</p>;

  function toggle(key: string) {
    if (key === sort) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setDir("desc");
    }
  }

  return (
    <div className="table-scroll" style={{ maxHeight }}>
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
          {sorted.map((r, i) => (
            <tr key={rowKey(r, columns, i)}>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
