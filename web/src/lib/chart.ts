/**
 * Turning a panel spec into ECharts options.
 *
 * The agent says what a chart means — this measure, over that column, split
 * by this one. Everything about how it looks is decided here, so a panel
 * cannot come out with unreadable axes or thirty colours because a model
 * had an opinion about geometry.
 *
 * The look follows the house style rather than ECharts' defaults: gradient
 * fills under a slightly darker stroke, dashed horizontal rules and no axis
 * lines at all, curves rather than elbows, and a tooltip that is a card
 * instead of a grey box. Motion is deliberate too — series draw in with a
 * stagger, hovering one dims the rest, and an edited panel morphs into its
 * new shape rather than blinking.
 */

import type { EChartsOption } from "echarts";

import type { PanelSpec, ValueFormat } from "@/lib/api";
import { INK, LINE, MUTED, PAPER, TONES } from "@/lib/theme";

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

// House motion. Entrances are unhurried; updates are quick, because an
// update is usually the agent editing a panel you are already looking at.
const ENTER_MS = 900;
const UPDATE_MS = 450;
const STAGGER_BUDGET_MS = 500;

// ---------------------------------------------------------------- colour

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A darker relative of a fill, for the stroke that sits on top of it.
 *
 * Done in HSL rather than by scaling the channels. The palette is pastel,
 * and scaling RGB on a pastel walks it towards grey — a blue fill ends up
 * with a slate stroke instead of a blue one.
 */
function darken(hex: string, light = 0.68, sat = 0.85): string {
  const [r, g, b] = channels(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return hsl(h, Math.min(1, s * sat), l * light);
}

function hsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

/** A vertical fade, strong at the top of the plot and nearly gone at the axis. */
function fade(hex: string, top = 0.9, bottom = 0.16) {
  return {
    type: "linear" as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: rgba(hex, top) },
      { offset: 1, color: rgba(hex, bottom) },
    ],
  };
}

// ------------------------------------------------------------ formatting

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

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

/** Percent columns arrive as either 0-1 or 0-100; decide once, per column. */
function percentScale(values: number[]): number {
  return values.every((v) => Math.abs(v) <= 1) ? 100 : 1;
}

// --------------------------------------------------------------- shaping

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

// ----------------------------------------------------------------- parts

const BASE = {
  color: PALETTE,
  textStyle: { fontFamily: "inherit", color: INK },
  animationDuration: ENTER_MS,
  animationEasing: "cubicOut" as const,
  animationDurationUpdate: UPDATE_MS,
  animationEasingUpdate: "cubicInOut" as const,
  // Hover feedback should feel immediate; the default 300ms reads as lag.
  stateAnimation: { duration: 180, easing: "cubicOut" as const },
};

/** A card, matching the tooltips elsewhere in the app. */
function tooltipCard(format: ValueFormat, scale: number) {
  return {
    trigger: "axis" as const,
    className: "chart-tip",
    // ECharts' own chrome is turned off so the stylesheet owns the look.
    backgroundColor: "transparent",
    borderWidth: 0,
    padding: 0,
    // Chasing the cursor exactly is jittery on a dense line.
    transitionDuration: 0.18,
    axisPointer: {
      type: "line" as const,
      lineStyle: { color: INK, width: 1, type: [3, 4] as [number, number] },
      z: 1,
    },
    formatter: (params: unknown) => {
      const rows = Array.isArray(params) ? params : [params];
      if (!rows.length) return "";

      // Axis-triggered tooltips get the axis label for free. Item-triggered
      // ones (scatter) have to name the x themselves, or the reading loses
      // half of what the point says.
      const first = rows[0] as { axisValueLabel?: string; value: unknown };
      const head = escapeHtml(
        String(
          first.axisValueLabel ??
            (Array.isArray(first.value) ? first.value[0] : ""),
        ),
      );
      const body = rows
        .map((p) => {
          const point = p as { seriesName?: string; color?: string; value: unknown };
          const raw = Array.isArray(point.value) ? point.value[1] : point.value;
          const swatch = `<i style="background:${point.color}"></i>`;
          return `<div class="chart-tip-row"><span>${swatch}${escapeHtml(
            String(point.seriesName ?? ""),
          )}</span><strong>${escapeHtml(
            formatValue(toNumber(raw) * scale, format),
          )}</strong></div>`;
        })
        .join("");

      return `${head ? `<div class="chart-tip-label">${head}</div>` : ""}${body}`;
    },
  };
}

function legend(show: boolean) {
  return show
    ? {
        top: 0,
        right: 0,
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 14,
        icon: "roundRect" as const,
        textStyle: { color: MUTED, fontSize: 11, fontWeight: 500 },
      }
    : { show: false };
}

// ---------------------------------------------------------------- charts

export function chartOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const { names, xs, values } = buildSeries(frame, spec);
  const flat = values.flat();
  const scale = spec.format === "percent" ? percentScale(flat) : 1;

  if (spec.type === "pie") {
    return pieOption(xs, values[0] ?? [], spec, scale);
  }

  // Dates deserve a real time axis. So do plain numbers, on anything other
  // than a bar chart: laying continuous values out as evenly spaced
  // categories puts every point in the wrong place, which is worse than
  // ugly. Bars stay categorical, since a bar needs a slot to sit in.
  const temporal = xs.length > 0 && xs.every((x) => ISO_DATE.test(String(x)));
  const numeric =
    !temporal &&
    spec.type !== "bar" &&
    xs.length > 0 &&
    xs.every((x) => x !== null && x !== "" && Number.isFinite(Number(x)));
  const many = names.length > 1;

  // Spread the entrance across a fixed budget so a 12-point bar chart and a
  // 400-point line both finish at about the same moment.
  const step = xs.length ? Math.min(STAGGER_BUDGET_MS / xs.length, 26) : 0;
  const stagger = (seriesIndex: number) => (idx: number) =>
    idx * step + seriesIndex * 90;

  const series = names.map((name, i) => {
    const tone = PALETTE[i % PALETTE.length];
    const stroke = darken(tone);
    // A time or value axis positions by the x it is given, so those series
    // carry pairs. A category axis takes bare values aligned to its labels.
    let data: (number | [number | string, number])[];
    if (temporal) {
      data = values[i].map((v, j) => [String(xs[j]), v * scale]);
    } else if (numeric) {
      const pairs: [number, number][] = values[i].map((v, j) => [
        Number(xs[j]),
        v * scale,
      ]);
      // A line joins points in data order, so unsorted x doubles back on
      // itself. Scatter has no such problem and is left alone.
      if (spec.type !== "scatter") pairs.sort((a, b) => a[0] - b[0]);
      data = pairs;
    } else {
      data = values[i].map((v) => v * scale);
    }

    const common = {
      id: name,
      name,
      data,
      animationDelay: stagger(i),
      animationDelayUpdate: stagger(i),
      // Editing a panel's chart type morphs the marks instead of redrawing.
      universalTransition: { enabled: true, divideShape: "clone" as const },
      emphasis: { focus: "series" as const, blurScope: "coordinateSystem" as const },
    };

    if (spec.type === "bar") {
      return {
        ...common,
        type: "bar" as const,
        stack: spec.stacked ? "total" : undefined,
        barMaxWidth: 44,
        itemStyle: {
          color: fade(tone, 0.95, 0.55),
          // Round the exposed top only. In a stack that is the last series
          // drawn; everything under it keeps square shoulders so the
          // segments still read as one column.
          borderRadius:
            spec.stacked && i !== names.length - 1
              ? 0
              : ([4, 4, 0, 0] as [number, number, number, number]),
        },
        emphasis: { ...common.emphasis, itemStyle: { color: tone } },
        blur: { itemStyle: { opacity: 0.25 } },
      };
    }

    if (spec.type === "scatter") {
      return {
        ...common,
        type: "scatter" as const,
        symbolSize: 10,
        itemStyle: {
          color: rgba(tone, 0.72),
          borderColor: stroke,
          borderWidth: 1,
        },
        emphasis: { ...common.emphasis, scale: 1.45 },
        blur: { itemStyle: { opacity: 0.16 } },
      };
    }

    // Stacked areas tile rather than overlap, so they can take a solid
    // fill. Unstacked ones sit on top of each other and have to stay faint
    // or the last series drawn hides the rest.
    const filled = spec.type === "area";
    const fill =
      spec.stacked ? fade(tone, 0.88, 0.3)
      : many ? fade(tone, 0.26, 0.03)
      : fade(tone, 0.45, 0.05);
    return {
      ...common,
      type: "line" as const,
      // Curves, but monotone on x so a smoothed line never invents a dip
      // below a value the data never reached.
      smooth: 0.35,
      smoothMonotone: "x" as const,
      stack: spec.stacked ? "total" : undefined,
      showSymbol: false,
      symbol: "circle",
      symbolSize: 7,
      lineStyle: {
        width: filled ? 1.8 : 2.1,
        color: stroke,
        cap: "round" as const,
        join: "round" as const,
      },
      itemStyle: { color: stroke, borderColor: PAPER, borderWidth: 1.5 },
      areaStyle: filled ? { color: fill, origin: "start" as const } : undefined,
      emphasis: { ...common.emphasis, scale: 1.3 },
      blur: {
        lineStyle: { opacity: 0.14 },
        areaStyle: { opacity: 0.06 },
      },
    };
  });

  const axisLabel = {
    color: MUTED,
    fontSize: 11,
    fontWeight: 500,
    hideOverlap: true,
    margin: 10,
  };

  const bareAxis = {
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: false },
  };

  // The three axis kinds accept different keys, so they are built
  // separately rather than as one object with a computed `type`.
  let xAxis: EChartsOption["xAxis"];
  if (temporal) {
    xAxis = { type: "time", ...bareAxis, axisLabel };
  } else if (numeric) {
    xAxis = {
      type: "value",
      ...bareAxis,
      // Points hard against the frame look like clipping, not data.
      scale: true,
      axisLabel: { ...axisLabel, formatter: (v: number) => formatValue(v, "compact") },
    };
  } else {
    xAxis = {
      type: "category",
      data: xs.map(String),
      boundaryGap: spec.type === "bar",
      ...bareAxis,
      axisLabel: {
        ...axisLabel,
        // Long category names are the usual cause of an unreadable axis.
        formatter: (v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v),
      },
    };
  }

  return {
    ...BASE,
    grid: { left: 4, right: 10, top: many ? 28 : 10, bottom: 0, containLabel: true },
    tooltip: {
      ...tooltipCard(spec.format, 1),
      trigger: spec.type === "scatter" ? "item" : "axis",
    },
    // Several series without a key is just coloured noise, so the legend
    // stays even on the smallest panel.
    legend: legend(many),
    xAxis,
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      // Horizontal rules only, dashed, so the marks stay the loudest thing.
      splitLine: { lineStyle: { color: LINE, type: [3, 6] as [number, number] } },
      axisLabel: {
        ...axisLabel,
        formatter: (v: number) => formatValue(v, spec.format),
      },
    },
    series,
  };
}

function pieOption(
  xs: unknown[],
  column: number[],
  spec: PanelSpec,
  scale: number,
): EChartsOption {
  const data = xs.map((x, i) => ({
    name: String(x),
    value: column[i] ?? 0,
    itemStyle: { color: PALETTE[i % PALETTE.length] },
  }));

  return {
    ...BASE,
    tooltip: {
      trigger: "item",
      className: "chart-tip",
      backgroundColor: "transparent",
      borderWidth: 0,
      padding: 0,
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number; percent: number; color: string };
        return (
          `<div class="chart-tip-label">${escapeHtml(p.name)}</div>` +
          `<div class="chart-tip-row"><span><i style="background:${p.color}"></i>Value</span>` +
          `<strong>${escapeHtml(formatValue(p.value * scale, spec.format))}</strong></div>` +
          `<div class="chart-tip-row"><span>Share</span><strong>${p.percent}%</strong></div>`
        );
      },
    },
    // The legend names every slice, so leader-line labels would say the
    // same thing twice and collide doing it.
    legend: {
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      icon: "roundRect",
      textStyle: { color: MUTED, fontSize: 11, fontWeight: 500 },
    },
    series: [
      {
        id: "slices",
        type: "pie",
        radius: ["48%", "74%"],
        center: ["50%", "42%"],
        padAngle: 1.5,
        itemStyle: { borderRadius: 5, borderColor: PAPER, borderWidth: 2 },
        label: { show: false },
        // Sweep the ring on rather than fading it in.
        animationType: "expansion",
        animationDelay: (idx: number) => idx * 70,
        universalTransition: { enabled: true, divideShape: "clone" },
        emphasis: {
          scaleSize: 8,
          itemStyle: {
            shadowBlur: 18,
            shadowColor: "rgba(24, 24, 27, 0.18)",
          },
        },
        blur: { itemStyle: { opacity: 0.3 } },
        data,
      },
    ],
  };
}

/** The single number a `stat` panel shows, already formatted. */
export function statValue(frame: Frame, spec: PanelSpec): string {
  const ci = frame.columns.indexOf(spec.y[0]);
  const raw = frame.rows[0]?.[ci];
  if (raw === null || raw === undefined) return "–";
  const value = toNumber(raw);
  const scale = spec.format === "percent" ? percentScale([value]) : 1;
  return formatValue(value * scale, spec.format);
}

/** The same number, unformatted, so a stat panel can count up to it. */
export function statNumber(frame: Frame, spec: PanelSpec): number | null {
  const ci = frame.columns.indexOf(spec.y[0]);
  const raw = frame.rows[0]?.[ci];
  if (raw === null || raw === undefined) return null;
  const value = toNumber(raw);
  return value * (spec.format === "percent" ? percentScale([value]) : 1);
}
