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

import type { ChartType, PanelData, PanelView, ValueFormat } from "@/lib/api";
import { loadWorldAtlas, type WorldAtlas } from "@/lib/atlas";
import { chartOption, formatValue, statNumber, statValue } from "@/lib/chart";
import { Waiting } from "@/components/spinner";

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

  return (
    <>
      <div className="tile-chart" ref={box} />
      {(kind === "map" || kind === "lines") && !atlas && (
        <Waiting label="Loading the world map" overlay />
      )}
    </>
  );
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

/** Put text on the clipboard, whatever the browser will let us use. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No clipboard permission, or an insecure origin. The old way still
    // works, and a copy button that silently does nothing is worse than a
    // deprecated call.
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.append(scratch);
    scratch.select();
    const done = document.execCommand("copy");
    scratch.remove();
    return done;
  }
}

// A shape with no data in it, for a chart whose query has not come back.
// Fixed rather than random so the server and the client draw the same bars,
// and so a placeholder does not reshuffle itself while you look at it.
const BARS = [46, 72, 58, 88, 64, 79, 51, 93, 68, 55];

/**
 * A chart-shaped hole, roughly the shape of the chart going into it.
 *
 * Shaped by kind because the alternative — one grey box for everything — makes
 * a table and a big number look like the same thing arriving, and the point of
 * a placeholder is that the page stops moving once it is up.
 */
function Bones({ kind }: { kind?: string }) {
  if (kind === "stat") {
    return (
      <div className="tile-stat" aria-hidden>
        <span className="bone bone-stat" />
      </div>
    );
  }

  if (kind === "table") {
    return (
      <div className="tile-bones is-table" aria-hidden>
        {BARS.slice(0, 6).map((width, i) => (
          <span key={i} className="bone bone-row" style={{ width: `${width}%` }} />
        ))}
      </div>
    );
  }

  return (
    <div className="tile-bones is-chart" aria-hidden>
      {BARS.map((height, i) => (
        <span key={i} className="bone bone-bar" style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

/**
 * A chart the analyst has started and not finished.
 *
 * It occupies the cell the real chart will occupy, at the width and height the
 * agent asked for, with the title it chose — all of which it wrote before the
 * query ran. So the grid reaches its final layout while the warehouse is still
 * working, and filling in a panel does not move the ones already drawn.
 */
export function PanelPlaceholder({
  title,
  chart,
  width = 6,
  height = 1,
}: {
  title?: string;
  chart?: string;
  width?: number;
  height?: number;
}) {
  return (
    <article
      className="tile is-building"
      aria-busy="true"
      style={{ gridColumn: `span ${width}`, gridRow: `span ${height}` }}
    >
      <header className="tile-head">
        <h3 className="tile-title" title={title}>
          {title || "New chart"}
        </h3>
        <span className="tile-flag">building</span>
      </header>
      <div className="tile-body">
        <Bones kind={chart} />
      </div>
    </article>
  );
}

/**
 * Take this chart with you.
 *
 * The clipboard gets a link to the chart, which the chat turns into an
 * attachment — so "update this one" or "what would you make from this" can be
 * asked about a specific panel without describing it. Pasted anywhere else it
 * is an ordinary link back to the canvas.
 *
 * A markdown link rather than a bare path, because the title is the half of
 * the reference a person reads and the id is the half the agent needs.
 */
function CopyReference({ title, path }: { title: string; path: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={`tile-copy${copied ? " is-copied" : ""}`}
      aria-label={copied ? "Copied" : "Copy this chart for the chat"}
      title={copied ? "Copied — paste it into the chat" : "Copy for the chat"}
      onClick={async () => {
        const href = `${window.location.origin}${path}`;
        setCopied(await copyText(`[${title}](${href})`));
      }}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

/**
 * One panel, drawn from whatever route its owner says holds its rows.
 *
 * The URL is passed in rather than derived from the panel, because a panel
 * on a dashboard and a proposal's own copy of one are stored in different
 * tables and served by different routes while drawing identically. One
 * renderer, two owners.
 */
export function PanelCard({
  panel,
  dataUrl,
  reference,
  expanded = false,
  onToggle,
  reloadKey,
  busy = false,
}: {
  panel: PanelView;
  dataUrl: string;
  /** This chart's canvas path, if it has one; enables the copy button. */
  reference?: string;
  expanded?: boolean;
  onToggle?: () => void;
  /**
   * Refetch the rows when this changes. The owner passes something derived
   * from the panel itself, so a chart re-runs its query when its query
   * changes and not because a sibling was added next to it.
   */
  reloadKey?: string | number;
  /** The analyst is rewriting this chart right now. */
  busy?: boolean;
}) {
  // One piece of state, so a reload replaces the old rows and the old error
  // together rather than briefly showing both.
  const [state, setState] = useState<{ data?: PanelData; error?: string }>({});
  const { data, error } = state;
  const version = reloadKey ?? "";

  useEffect(() => {
    const ac = new AbortController();

    fetch(dataUrl, { signal: ac.signal })
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
  }, [dataUrl, version]);

  const kind = panel.spec.type;

  return (
    <article
      className={`tile${expanded ? " is-expanded" : ""}${
        kind === "map" || kind === "lines" ? " is-geo" : ""
      }${busy ? " is-busy" : ""}`}
      aria-busy={busy || undefined}
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
        {busy && <span className="tile-flag">rewriting</span>}
        {reference && <CopyReference title={panel.title} path={reference} />}
        {onToggle && (
          <button
            type="button"
            className="tile-zoom"
            onClick={onToggle}
            aria-label={expanded ? "Shrink panel" : "Expand panel"}
            title={expanded ? "Shrink" : "Expand"}
          >
            {expanded ? "⤡" : "⤢"}
          </button>
        )}
      </header>

      <div className="tile-body">
        {error && <p className="tile-error">{error}</p>}
        {/* Bones rather than a spinner: this chart's shape is known — it is
            the one thing about it that arrived before its numbers — and a
            row of them reads as a page filling in rather than as several
            things stalling at once. */}
        {!error && !data && <Bones kind={kind} />}
        {data && <TileBody kind={kind} data={data} />}
      </div>
    </article>
  );
}
