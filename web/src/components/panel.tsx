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

import type { ChartType, Panel, PanelData, ValueFormat } from "@/lib/api";
import { loadWorldAtlas, type WorldAtlas } from "@/lib/atlas";
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

/**
 * The world geometry, for map panels only.
 *
 * Returns undefined until it has loaded. Nothing else needs it, so no other
 * panel pays for the fetch.
 */
function useAtlas(kind: ChartType) {
  const [atlas, setAtlas] = useState<WorldAtlas>();
  const [failed, setFailed] = useState<string>();

  useEffect(() => {
    if (kind !== "map" && kind !== "lines") return;
    let dropped = false;

    loadWorldAtlas()
      .then((loaded) => !dropped && setAtlas(loaded))
      .catch((e: unknown) => !dropped && setFailed(String(e)));

    return () => {
      dropped = true;
    };
  }, [kind]);

  return { atlas, failed };
}

function Chart({ data }: { data: PanelData }) {
  const box = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<echarts.ECharts | null>(null);
  const kind = data.panel.spec.type;
  const { atlas, failed } = useAtlas(kind);

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
    // Drawing a map before the geometry arrives would register an empty
    // one, and ECharts caches that by name for every later panel.
    if ((kind === "map" || kind === "lines") && !atlas) return;

    chart.setOption(
      chartOption({ columns: data.columns, rows: data.rows }, data.panel.spec, atlas),
      // Replace rather than merge: an edited panel can have fewer series
      // than it did, and a merge would leave the old ones drawn.
      { notMerge: true },
    );
  }, [chart, data, kind, atlas]);

  if (failed) return <p className="tile-error">Could not load the world map: {failed}</p>;

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

/**
 * Whatever a panel's type says it should be.
 *
 * Exhaustive on purpose. The chart vocabulary is defined by the backend
 * registry, and this switch is where the client agrees to it: adding a
 * member to `ChartType` without adding a case here narrows `kind` to
 * `never` in the default branch and fails the build. Previously an
 * unrecognised type fell through and was silently drawn as a line.
 */
function TileBody({ kind, data }: { kind: ChartType; data: PanelData }) {
  switch (kind) {
    case "table":
      return <TableBlock data={data} />;
    case "stat":
      return <StatBlock data={data} />;
    case "line":
    case "area":
    case "bar":
    case "scatter":
    case "pie":
    case "funnel":
    case "heatmap":
    case "calendar":
    case "treemap":
    case "sunburst":
    case "sankey":
    case "boxplot":
    case "map":
    case "radar":
    case "gauge":
    case "graph":
    case "tree":
    case "themeRiver":
    case "chord":
    case "parallel":
    case "pictorialBar":
    case "effectScatter":
    case "candlestick":
    case "lines":
      return <Chart data={data} />;
    default: {
      // Unreachable while every member of ChartType has a case above, which
      // is what makes this assignment compile. It still renders, because a
      // client can be older than the backend that sent the panel.
      const unhandled: never = kind;
      return (
        <p className="tile-error">
          This build has no renderer for a {String(unhandled)} panel.
        </p>
      );
    }
  }
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
    const ac = new AbortController();

    fetch(`/api/dashboards/${panel.dashboard_id}/panels/${panel.id}`, {
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<PanelData>;
      })
      .then((body) => setState({ data: body }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setState({ error: String(e) });
      });

    return () => ac.abort();
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
        {data && <TileBody kind={kind} data={data} />}
      </div>
    </article>
  );
}
