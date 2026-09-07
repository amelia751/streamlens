/**
 * Turning a panel spec into ECharts options.
 *
 * The agent says what a chart means — this measure, over that column, split
 * by this one. Everything about how it looks is decided here, so a panel
 * cannot come out with unreadable axes or thirty colours because a model
 * had an opinion about geometry.
 */

import type { EChartsOption } from "echarts";

import type { PanelSpec, ValueFormat } from "@/lib/api";
import { INK, LINE, MUTED, TONES } from "@/lib/theme";

const PALETTE = [
  TONES.blue,
  TONES.yellow,
  TONES.green,
  TONES.purple,
  TONES.teal,
  "#e8a87c",
  "#c38d9e",
  "#8d9db6",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export function formatValue(value: number, format: ValueFormat): string {
  if (!Number.isFinite(value)) return "–";

  switch (format) {
    case "compact":
      return new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);

    case "percent":
      return `${round(value)}%`;

    case "currency":
      return new Intl.NumberFormat("en", {
        style: "currency",
        currency: "USD",
        notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(value);

    case "bytes": {
      const units = ["B", "KB", "MB", "GB", "TB", "PB"];
      let n = value;
      let unit = 0;
      while (Math.abs(n) >= 1024 && unit < units.length - 1) {
        n /= 1024;
        unit += 1;
      }
      return `${round(n)} ${units[unit]}`;
    }

    case "duration": {
      const total = Math.round(value);
      if (total < 60) return `${total}s`;
      if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
      return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
    }

    default:
      return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(
        value,
      );
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Percent columns arrive as either 0-1 or 0-100; decide once, per column. */
function percentScale(values: number[]): number {
  return values.every((v) => Math.abs(v) <= 1) ? 100 : 1;
}

type Frame = {
  columns: string[];
  rows: unknown[][];
};

function indexOf(frame: Frame, column: string | null): number {
  return column ? frame.columns.indexOf(column) : -1;
}

/**
 * One series per `y` column, or one per distinct value of `series`.
 *
 * Splitting by `series` needs a pivot: the query returns one row per
 * (x, series) pair, and a chart needs one array per series aligned to a
 * shared x axis.
 */
function buildSeries(
  frame: Frame,
  spec: PanelSpec,
): { names: string[]; xs: unknown[]; values: number[][] } {
  const xi = indexOf(frame, spec.x);
  const si = indexOf(frame, spec.series);

  if (si === -1) {
    const xs = frame.rows.map((row) => (xi === -1 ? "" : row[xi]));
    return {
      names: spec.y,
      xs,
      values: spec.y.map((column) => {
        const ci = frame.columns.indexOf(column);
        return frame.rows.map((row) => toNumber(row[ci]));
      }),
    };
  }

  const yi = frame.columns.indexOf(spec.y[0]);
  const xs = [...new Set(frame.rows.map((row) => String(row[xi])))];
  const names = [...new Set(frame.rows.map((row) => String(row[si])))];
  const slot = new Map(xs.map((x, i) => [x, i]));

  const values = names.map((name) => {
    const column = new Array(xs.length).fill(0);
    for (const row of frame.rows) {
      if (String(row[si]) !== name) continue;
      column[slot.get(String(row[xi])) ?? 0] = toNumber(row[yi]);
    }
    return column;
  });

  return { names, xs, values };
}

const BASE = {
  color: PALETTE,
  textStyle: { fontFamily: "inherit", color: INK },
  animationDuration: 300,
};

function axisLabel(scale: number, format: ValueFormat) {
  return {
    color: MUTED,
    fontSize: 11,
    formatter: (v: number) => formatValue(v * scale, format),
  };
}

export function chartOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const { names, xs, values } = buildSeries(frame, spec);
  const flat = values.flat();
  const scale = spec.format === "percent" ? percentScale(flat) : 1;

  if (spec.type === "pie") {
    const data = xs.map((x, i) => ({
      name: String(x),
      value: values[0]?.[i] ?? 0,
    }));
    return {
      ...BASE,
      tooltip: {
        trigger: "item",
        valueFormatter: (v) => formatValue(toNumber(v) * scale, spec.format),
      },
      // The legend names every slice, so leader-line labels would say the
      // same thing twice and collide doing it.
      legend: {
        bottom: 0,
        textStyle: { color: MUTED, fontSize: 11 },
        icon: "roundRect",
        itemHeight: 8,
      },
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          center: ["50%", "42%"],
          itemStyle: { borderColor: "#fff", borderWidth: 2 },
          label: { show: false },
          data,
        },
      ],
    };
  }

  // Dates deserve a real time axis; anything else is a category.
  const temporal =
    xs.length > 0 && xs.every((x) => ISO_DATE.test(String(x)));

  const series = names.map((name, i) => ({
    name,
    type: (spec.type === "scatter"
      ? "scatter"
      : spec.type === "bar"
        ? "bar"
        : "line") as "scatter" | "bar" | "line",
    stack: spec.stacked ? "total" : undefined,
    areaStyle: spec.type === "area" ? { opacity: 0.7 } : undefined,
    smooth: false,
    showSymbol: spec.type === "scatter" || xs.length < 40,
    symbolSize: spec.type === "scatter" ? 7 : 4,
    lineStyle: { width: 1.8 },
    data: temporal
      ? values[i].map((v, j) => [String(xs[j]), v * scale])
      : values[i].map((v) => v * scale),
  }));

  const many = names.length > 1;

  const axisBase = {
    axisLine: { lineStyle: { color: LINE } },
    axisTick: { show: false },
  };

  // Split rather than one object with a computed `type`: the two axis kinds
  // accept different keys, and merging them loses that distinction.
  const xAxis: EChartsOption["xAxis"] = temporal
    ? {
        ...axisBase,
        type: "time",
        axisLabel: { color: MUTED, fontSize: 11, hideOverlap: true },
      }
    : {
        ...axisBase,
        type: "category",
        data: xs.map(String),
        boundaryGap: spec.type === "bar",
        axisLabel: {
          color: MUTED,
          fontSize: 11,
          hideOverlap: true,
          // Long category names are the usual cause of an unreadable axis.
          formatter: (v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v),
        },
      };

  return {
    ...BASE,
    grid: {
      left: 8,
      right: 12,
      top: many ? 30 : 12,
      bottom: 4,
      containLabel: true,
    },
    tooltip: {
      trigger: spec.type === "scatter" ? "item" : "axis",
      axisPointer: { type: "line", lineStyle: { color: LINE } },
      valueFormatter: (v) => formatValue(toNumber(v), spec.format),
    },
    // Several series without a key is just coloured noise, so the legend
    // stays even on the smallest panel.
    legend: many
      ? {
          top: 0,
          right: 0,
          textStyle: { color: MUTED, fontSize: 11 },
          icon: "roundRect",
          itemHeight: 8,
        }
      : { show: false },
    xAxis,
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: LINE, type: "dashed" } },
      axisLabel: axisLabel(1, spec.format),
    },
    series,
  };
}

/** The single number a `stat` panel shows, already formatted. */
export function statValue(frame: Frame, spec: PanelSpec): string {
  const ci = frame.columns.indexOf(spec.y[0]);
  const raw = frame.rows[0]?.[ci];
  if (raw === null || raw === undefined) return "–";
  const value = toNumber(raw);
  const scale =
    spec.format === "percent" ? percentScale([value]) : 1;
  return formatValue(value * scale, spec.format);
}
