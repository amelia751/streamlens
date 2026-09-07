"use client";

/**
 * One panel: its stored query replayed, drawn as whatever its spec says.
 *
 * ECharts is driven directly rather than through a React wrapper. A chart
 * is a mutable canvas, not a tree of elements, and `setOption` on an
 * existing instance is what makes resizing and expanding smooth.
 */

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";

import type { Panel, PanelData, ValueFormat } from "@/lib/api";
import { chartOption, formatValue, statNumber, statValue } from "@/lib/chart";

function useResize(
  ref: React.RefObject<HTMLDivElement | null>,
  chart: echarts.ECharts | null,
) {
  useEffect(() => {
    const node = ref.current;
    if (!node || !chart) return;
    // Expanding a panel changes its box without changing the window, so a
    // window resize listener is not enough.
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, chart]);
}

function Chart({ data }: { data: PanelData }) {
  const box = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const instance = echarts.init(box.current, undefined, {
      renderer: "canvas",
    });
    setChart(instance);
    return () => instance.dispose();
  }, []);

  useResize(box, chart);

  useEffect(() => {
    if (!chart) return;
    chart.setOption(
      chartOption({ columns: data.columns, rows: data.rows }, data.panel.spec),
      // Replace rather than merge: an edited panel can have fewer series
      // than it did, and a merge would leave the old ones drawn.
      { notMerge: true },
    );
  }, [chart, data]);

  return <div className="tile-chart" ref={box} />;
}

/**
 * Counts up to the figure instead of just appearing as it.
 *
 * A stat sitting next to charts that draw themselves in looks broken if it
 * is the one static thing on the grid. Every state change happens inside
 * the frame callback, so the first painted value is near zero rather than
 * the answer.
 */
function CountUp({ value, format }: { value: number; format: ValueFormat }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      if (still) {
        setShown(value);
        return;
      }
      const progress = Math.min(1, (now - started) / 900);
      // Cubic ease-out, the same curve the charts enter on.
      setShown(value * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{formatValue(shown, format)}</>;
}

function StatBlock({ data }: { data: PanelData }) {
  const frame = { columns: data.columns, rows: data.rows };
  const value = statNumber(frame, data.panel.spec);

  return (
    <div className="tile-stat">
      <span className="tile-stat-value">
        {value === null ? (
          statValue(frame, data.panel.spec)
        ) : (
          <CountUp value={value} format={data.panel.spec.format} />
        )}
      </span>
    </div>
  );
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (Array.isArray(value)) return value.length ? `[${value.join(", ")}]` : "[]";
  return String(value);
}

function isNumeric(type: string): boolean {
  return /^(Nullable\()?(U?Int|Float|Decimal)/.test(type);
}

function TableBlock({ data }: { data: PanelData }) {
  return (
    <div className="tile-table-scroll">
      <table className="grid-table">
        <thead>
          <tr>
            {data.columns.map((column) => (
              <th key={column}>
                <span className="grid-col">{column}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>
              {row.map((value, j) => (
                <td
                  key={j}
                  className={isNumeric(data.types[j] ?? "") ? "is-number" : undefined}
                >
                  <span className={value === null ? "is-null" : undefined}>
                    {cellText(value)}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PanelCard({
  panel,
  expanded,
  onToggle,
  reloadKey,
}: {
  panel: Panel;
  expanded: boolean;
  onToggle: () => void;
  reloadKey: number;
}) {
  // One piece of state, so a reload replaces the old rows and the old error
  // together rather than briefly showing both.
  const [state, setState] = useState<{ data?: PanelData; error?: string }>({});
  const { data, error } = state;

  useEffect(() => {
    let dropped = false;

    fetch(`/api/dashboards/${panel.dashboard_id}/panels/${panel.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<PanelData>;
      })
      .then((body) => !dropped && setState({ data: body }))
      .catch((e: unknown) => !dropped && setState({ error: String(e) }));

    return () => {
      dropped = true;
    };
  }, [panel.dashboard_id, panel.id, reloadKey]);

  const kind = panel.spec.type;

  return (
    <article
      className={`tile${expanded ? " is-expanded" : ""}`}
      style={
        expanded
          ? undefined
          : {
              gridColumn: `span ${panel.width}`,
              gridRow: `span ${panel.height}`,
            }
      }
    >
      <header className="tile-head">
        <h3 className="tile-title" title={panel.title}>
          {panel.title}
        </h3>
        <button
          type="button"
          className="tile-zoom"
          onClick={onToggle}
          aria-label={expanded ? "Shrink panel" : "Expand panel"}
          title={expanded ? "Shrink" : "Expand"}
        >
          {expanded ? "⤡" : "⤢"}
        </button>
      </header>

      <div className="tile-body">
        {error && <p className="tile-error">{error}</p>}
        {!error && !data && <p className="tile-waiting">Running query…</p>}
        {data && kind === "table" && <TableBlock data={data} />}
        {data && kind === "stat" && <StatBlock data={data} />}
        {data && kind !== "table" && kind !== "stat" && (
          <Chart data={data} />
        )}
      </div>
    </article>
  );
}
