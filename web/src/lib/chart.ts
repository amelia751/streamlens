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
import { WORLD_MAP, resolvePlace, type WorldAtlas } from "@/lib/atlas";
import { FAINT, INK, LINE, MUTED, PAPER, TONES } from "@/lib/theme";

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

function measureScale(values: number[], format: ValueFormat): number {
  return format === "percent" ? percentScale(values) : 1;
}

/** The tooltip card's contents: a heading, then label/value rows. */
function tip(
  head: string,
  rows: { label: string; value: string; color?: string }[],
): string {
  const body = rows
    .map(
      ({ label, value, color }) =>
        `<div class="chart-tip-row"><span>${
          color ? `<i style="background:${color}"></i>` : ""
        }${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("");
  const title = head ? `<div class="chart-tip-label">${escapeHtml(head)}</div>` : "";
  return title + body;
}

// --------------------------------------------------------------- shaping

type Frame = {
  columns: string[];
  rows: unknown[][];
};

function indexOf(frame: Frame, column: string | null): number {
  return column ? frame.columns.indexOf(column) : -1;
}

/** One column's values, in row order. Empty if the column is not there. */
function columnAt(frame: Frame, column: string | null): unknown[] {
  const i = indexOf(frame, column);
  return i === -1 ? [] : frame.rows.map((row) => row[i]);
}

function numbersAt(frame: Frame, column: string | null): number[] {
  const i = indexOf(frame, column);
  return i === -1 ? [] : frame.rows.map((row) => toNumber(row[i]));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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

/**
 * The card ECharts draws around a tooltip, matched to the ones elsewhere in
 * the app.
 *
 * ECharts owns the box and the stylesheet owns what goes inside it. Styling
 * the box from CSS instead means overriding ECharts' inline styles, and
 * those overrides also apply while the tooltip is empty and parked at the
 * bottom of the chart — which paints an empty card on the panel.
 */
const CARD = {
  backgroundColor: PAPER,
  borderColor: LINE,
  borderWidth: 1,
  borderRadius: 8,
  padding: [8, 10, 9, 10] as [number, number, number, number],
  extraCssText: "box-shadow: 0 10px 28px rgb(24 24 27 / 8%); max-width: 16rem;",
  textStyle: { color: INK, fontSize: 12 },
};

function tooltipCard(format: ValueFormat, scale: number) {
  return {
    ...CARD,
    trigger: "axis" as const,
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

/** Roughly a three-column tile. Below this, the defaults start to crowd. */
const NARROW = 380;

/**
 * ECharts' own responsive layer.
 *
 * A panel can be anything from two columns to the whole canvas, and the
 * same option is not right across that range. Rather than threading the
 * tile's width through React and rebuilding on every resize, the chart is
 * handed both variants and picks one itself whenever it is resized.
 *
 * Every key set in one variant is set in the other. ECharts merges these
 * rather than replacing, so anything mentioned only under the narrow query
 * would stick when the panel grew back.
 */
function cartesianMedia(many: boolean) {
  return [
    {
      query: { maxWidth: NARROW },
      option: {
        grid: { top: many ? 24 : 6, left: 2, right: 6 },
        legend: {
          itemGap: 8,
          itemWidth: 8,
          itemHeight: 8,
          textStyle: { fontSize: 10 },
        },
        xAxis: { axisLabel: { fontSize: 10, margin: 7 } },
        yAxis: { axisLabel: { fontSize: 10, margin: 7 } },
      },
    },
    {
      option: {
        grid: { top: many ? 28 : 10, left: 4, right: 10 },
        legend: {
          itemGap: 14,
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { fontSize: 11 },
        },
        xAxis: { axisLabel: { fontSize: 11, margin: 10 } },
        yAxis: { axisLabel: { fontSize: 11, margin: 10 } },
      },
    },
  ];
}

/** The same idea for a donut, where the ring itself has to give ground. */
function pieMedia() {
  return [
    {
      query: { maxWidth: NARROW },
      option: {
        // Too narrow to wrap the names without eating the ring, so the
        // legend paginates instead.
        legend: { type: "scroll", itemGap: 8, textStyle: { fontSize: 10 } },
        series: [{ radius: ["42%", "68%"], center: ["50%", "38%"] }],
      },
    },
    {
      option: {
        // With room, every slice is named at once. Pagination arrows for
        // the handful of slices a donut should have is just clutter.
        legend: { type: "plain", itemGap: 14, textStyle: { fontSize: 11 } },
        series: [{ radius: ["48%", "74%"], center: ["50%", "42%"] }],
      },
    },
  ];
}

/**
 * A single-hue ramp, for charts that shade by magnitude.
 *
 * The eight-colour palette is exactly wrong here. Distinct hues say "these
 * are different things", and a heatmap or a choropleth is saying "this one
 * is more than that one" — an ordering the eye should read without
 * consulting a key. So one hue, varying only in how much of it there is.
 */
function ramp(hex: string): string[] {
  return [rgba(hex, 0.07), rgba(hex, 0.32), rgba(hex, 0.66), hex, darken(hex, 0.7)];
}

/** The key beside a shaded chart, which is also its only axis. */
function shadeScale(
  min: number,
  max: number,
  format: ValueFormat,
  hex: string = TONES.blue,
) {
  return {
    type: "continuous" as const,
    // A flat sheet of one colour is what a zero-width range produces.
    min,
    max: max > min ? max : min + 1,
    calculable: false,
    orient: "horizontal" as const,
    left: "center" as const,
    bottom: 4,
    itemWidth: 10,
    itemHeight: 180,
    inRange: { color: ramp(hex) },
    textStyle: { color: MUTED, fontSize: 10, fontWeight: 500 },
    // ECharts hands the range ends through as loosely typed option values.
    formatter: (v: unknown) => formatValue(toNumber(v), format),
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

/**
 * The option for a panel, chosen by what its spec says it is.
 *
 * Each family reads different channels and lays out differently enough
 * that one function with branches inside it would be worse than several.
 * `atlas` is only consulted by `map`, which cannot resolve a country name
 * until the geometry has loaded.
 */
export function chartOption(
  frame: Frame,
  spec: PanelSpec,
  atlas?: WorldAtlas,
): EChartsOption {
  switch (spec.type) {
    case "pie":
      return pieOption(frame, spec);
    case "funnel":
      return funnelOption(frame, spec);
    case "heatmap":
      return heatmapOption(frame, spec);
    case "calendar":
      return calendarOption(frame, spec);
    case "treemap":
    case "sunburst":
      return hierarchyOption(frame, spec);
    case "sankey":
      return sankeyOption(frame, spec);
    case "boxplot":
      return boxplotOption(frame, spec);
    case "map":
      return mapOption(frame, spec, atlas);
    case "radar":
      return radarOption(frame, spec);
    case "gauge":
      return gaugeOption(frame, spec);
    case "graph":
      return graphOption(frame, spec);
    case "tree":
      return treeOption(frame, spec);
    case "themeRiver":
      return themeRiverOption(frame, spec);
    case "chord":
      return chordOption(frame, spec);
    case "parallel":
      return parallelOption(frame, spec);
    case "pictorialBar":
      return pictorialBarOption(frame, spec);
    case "candlestick":
      return candlestickOption(frame, spec);
    case "lines":
      return linesOption(frame, spec, atlas);
    default:
      return cartesianOption(frame, spec);
  }
}

function cartesianOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const { names, xs, values } = buildSeries(frame, spec);
  const scale = measureScale(values.flat(), spec.format);

  // Dates deserve a real time axis. So do plain numbers, on anything other
  // than a bar chart: laying continuous values out as evenly spaced
  // categories puts every point in the wrong place, which is worse than
  // ugly. Bars stay categorical, since a bar needs a slot to sit in.
  const temporal = xs.length > 0 && xs.every((x) => ISO_DATE.test(String(x)));
  const numeric =
    !temporal &&
    spec.type !== "bar" &&
    spec.type !== "pictorialBar" &&
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

    if (spec.type === "scatter" || spec.type === "effectScatter") {
      return {
        ...common,
        type: spec.type === "effectScatter" ? ("effectScatter" as const) : ("scatter" as const),
        symbolSize: spec.type === "effectScatter" ? 12 : 10,
        itemStyle: {
          color: rgba(tone, 0.72),
          borderColor: stroke,
          borderWidth: 1,
        },
        rippleEffect:
          spec.type === "effectScatter"
            ? { scale: 3.2, brushType: "stroke" as const, period: 3.4, color: stroke }
            : undefined,
        showEffectOn: spec.type === "effectScatter" ? ("render" as const) : undefined,
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
      boundaryGap: spec.type === "bar" || spec.type === "pictorialBar" || spec.type === "candlestick",
      ...bareAxis,
      axisLabel: {
        ...axisLabel,
        // Offer every category and let hideOverlap thin them by what
        // actually collides, rather than by how many there are.
        interval: 0,
        // Long category names are the usual cause of an unreadable axis.
        formatter: (v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v),
      },
    };
  }

  return {
    baseOption: {
      ...BASE,
      grid: {
        left: 4,
        right: 10,
        bottom: temporal && xs.length > 60 ? 8 : 0,
        containLabel: true,
      },
      // A long time series can be pinched; the slider stays off the tile
      // so the chart does not grow a second axis of chrome.
      dataZoom:
        temporal && xs.length > 60
          ? [{ type: "inside" as const, filterMode: "none" as const, zoomOnMouseWheel: false }]
          : undefined,
      tooltip: {
        ...tooltipCard(spec.format, 1),
        trigger: spec.type === "scatter" || spec.type === "effectScatter" ? "item" : "axis",
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
    },
    media: cartesianMedia(many),
  };
}

function pieOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const xs = columnAt(frame, spec.x);
  const column = numbersAt(frame, spec.y[0] ?? null);
  const scale = measureScale(column, spec.format);

  const data = xs.map((x, i) => ({
    name: String(x),
    value: (column[i] ?? 0) * scale,
    itemStyle: { color: PALETTE[i % PALETTE.length] },
  }));

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item",
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number; percent: number; color: string };
          return tip(p.name, [
            { label: "Value", value: formatValue(p.value, spec.format), color: p.color },
            { label: "Share", value: `${p.percent}%` },
          ]);
        },
      },
      // The legend names every slice, so leader-line labels would say the
      // same thing twice and collide doing it.
      legend: {
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        icon: "roundRect" as const,
        textStyle: { color: MUTED, fontSize: 11, fontWeight: 500 },
      },
      series: [
        {
          id: "slices",
          type: "pie" as const,
          radius: ["48%", "74%"],
          center: ["50%", "42%"],
          padAngle: 1.5,
          itemStyle: { borderRadius: 5, borderColor: PAPER, borderWidth: 2 },
          label: { show: false },
          // Sweep the ring on rather than fading it in.
          animationType: "expansion" as const,
          animationDelay: (idx: number) => idx * 70,
          universalTransition: { enabled: true, divideShape: "clone" as const },
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
    },
    media: pieMedia(),
  };
}

/**
 * Steps of a process, each a share of the one above it.
 *
 * The names sit inside the blocks, which is the whole advantage of a funnel
 * over a bar chart — until the panel is too narrow for them, when they move
 * out to a legend instead.
 */
function funnelOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const names = columnAt(frame, spec.x).map(String);
  const column = numbersAt(frame, spec.y[0] ?? null);
  const scale = measureScale(column, spec.format);
  const top = (column[0] ?? 0) * scale;

  const data = names.map((name, i) => ({
    name,
    value: (column[i] ?? 0) * scale,
    itemStyle: {
      color: fade(PALETTE[i % PALETTE.length], 0.95, 0.62),
      borderColor: PAPER,
      borderWidth: 2,
    },
  }));

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item",
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number; color: string };
          const rows = [
            { label: "Value", value: formatValue(p.value, spec.format), color: p.color },
          ];
          // The drop from the first step is the number a funnel is drawn to
          // answer, and it is not one the reader should be doing by eye.
          if (top > 0) {
            rows.push({
              label: "Of first step",
              value: `${Math.round((p.value / top) * 1000) / 10}%`,
              color: undefined as unknown as string,
            });
          }
          return tip(p.name, rows);
        },
      },
      legend: {
        show: false,
        bottom: 0,
        itemWidth: 10,
        itemHeight: 10,
        icon: "roundRect" as const,
        textStyle: { color: MUTED, fontSize: 10, fontWeight: 500 },
      },
      series: [
        {
          id: "steps",
          type: "funnel" as const,
          top: 6,
          bottom: 6,
          left: "6%",
          right: "6%",
          minSize: "22%",
          sort: "descending" as const,
          gap: 3,
          itemStyle: { borderRadius: 4 },
          label: {
            show: true,
            position: "inside" as const,
            color: INK,
            fontSize: 11,
            fontWeight: 600,
            overflow: "truncate" as const,
          },
          labelLine: { show: false },
          animationDelay: (idx: number) => idx * 80,
          universalTransition: { enabled: true, divideShape: "clone" as const },
          emphasis: { focus: "series" as const, label: { fontSize: 12 } },
          blur: { itemStyle: { opacity: 0.3 } },
          data,
        },
      ],
    },
    media: [
      {
        query: { maxWidth: NARROW },
        option: {
          legend: { show: true, type: "scroll" },
          series: [{ bottom: 26, label: { show: false } }],
        },
      },
      {
        option: {
          legend: { show: false, type: "plain" },
          series: [{ bottom: 6, label: { show: true } }],
        },
      },
    ],
  };
}

/** One measure across two categories, shaded rather than plotted. */
function heatmapOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const rowColumn = spec.y[0] ?? null;
  const xs = unique(columnAt(frame, spec.x).map(String));
  const ys = unique(columnAt(frame, rowColumn).map(String));
  const scale = measureScale(numbersAt(frame, spec.value), spec.format);

  const xi = indexOf(frame, spec.x);
  const yi = indexOf(frame, rowColumn);
  const vi = indexOf(frame, spec.value);
  const xslot = new Map(xs.map((v, i) => [v, i]));
  const yslot = new Map(ys.map((v, i) => [v, i]));

  const data = frame.rows.map((row) => [
    xslot.get(String(row[xi])) ?? 0,
    yslot.get(String(row[yi])) ?? 0,
    toNumber(row[vi]) * scale,
  ]);

  const values = data.map((d) => d[2]);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;

  const label = { color: MUTED, fontSize: 10, fontWeight: 500, hideOverlap: true };
  const bare = { axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } };

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as { value: [number, number, number] };
          const [cx, cy, v] = p.value;
          return tip(`${xs[cx] ?? ""} · ${ys[cy] ?? ""}`, [
            { label: "Value", value: formatValue(v, spec.format) },
          ]);
        },
      },
      // The scale sits under the plot, so the grid has to clear both it and
      // the axis labels or the two are drawn on top of each other.
      grid: { top: 6, left: 2, right: 8, bottom: 44, containLabel: true },
      xAxis: { type: "category" as const, data: xs, ...bare, axisLabel: label },
      yAxis: {
        type: "category" as const,
        data: ys,
        // A category axis counts up from the bottom, which puts the first
        // row of the query at the foot of the chart. A heatmap is read like
        // a table, so the first row belongs at the top.
        inverse: true,
        ...bare,
        axisLabel: label,
      },
      visualMap: shadeScale(min, max, spec.format),
      series: [
        {
          id: "cells",
          type: "heatmap" as const,
          data,
          // The gap between cells is a paper-coloured border rather than a
          // real gap, so the grid reads as tiles instead of a bitmap.
          itemStyle: { borderColor: PAPER, borderWidth: 2, borderRadius: 3 },
          animationDelay: (idx: number) => Math.min(idx * 4, STAGGER_BUDGET_MS),
          emphasis: {
            itemStyle: { borderColor: INK, borderWidth: 1.5, shadowBlur: 10 },
          },
          blur: { itemStyle: { opacity: 0.35 } },
        },
      ],
    },
    media: [
      { query: { maxWidth: NARROW }, option: { xAxis: { axisLabel: { fontSize: 9 } }, yAxis: { axisLabel: { fontSize: 9 } } } },
      { option: { xAxis: { axisLabel: { fontSize: 10 } }, yAxis: { axisLabel: { fontSize: 10 } } } },
    ],
  };
}

/** Daily activity laid out as weeks, where the rhythm is the point. */
function calendarOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const xi = indexOf(frame, spec.x);
  const vi = indexOf(frame, spec.value);
  const scale = measureScale(numbersAt(frame, spec.value), spec.format);

  const data = frame.rows
    .map(
      (row) =>
        [String(row[xi] ?? "").slice(0, 10), toNumber(row[vi]) * scale] as [string, number],
    )
    .filter(([day]) => ISO_DATE.test(day))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const values = data.map(([, v]) => v);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const range = data.length ? [data[0][0], data[data.length - 1][0]] : undefined;

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as { value: [string, number] };
          return tip(p.value[0], [
            { label: "Value", value: formatValue(p.value[1], spec.format) },
          ]);
        },
      },
      visualMap: shadeScale(min, max, spec.format, TONES.green),
      calendar: {
        top: 24,
        left: 32,
        right: 8,
        bottom: 36,
        range,
        cellSize: ["auto", "auto"],
        splitLine: { show: false },
        // An empty day is a fainter version of the grid, not a hole in it.
        itemStyle: { color: PAPER, borderColor: LINE, borderWidth: 1 },
        yearLabel: { show: false },
        dayLabel: { color: MUTED, fontSize: 9, firstDay: 1 },
        monthLabel: { color: MUTED, fontSize: 10 },
      },
      series: [
        {
          id: "days",
          type: "heatmap" as const,
          coordinateSystem: "calendar" as const,
          data,
          itemStyle: { borderColor: PAPER, borderWidth: 1.5, borderRadius: 2 },
          animationDelay: (idx: number) => Math.min(idx * 2, STAGGER_BUDGET_MS),
          emphasis: { itemStyle: { borderColor: INK, borderWidth: 1.5 } },
        },
      ],
    },
    media: [
      { query: { maxWidth: NARROW }, option: { calendar: { left: 24, dayLabel: { show: false } } } },
      { option: { calendar: { left: 32, dayLabel: { show: true } } } },
    ],
  };
}

type Branch = { name: string; value: number; children: Branch[] };

/** Roll the rows up into the nesting named by `path`, summing as it goes. */
function buildTree(frame: Frame, path: string[], value: string | null, scale: number): Branch[] {
  const levels = path.map((c) => frame.columns.indexOf(c)).filter((i) => i !== -1);
  const vi = indexOf(frame, value);
  const roots: Branch[] = [];
  const seen = new Map<string, Branch>();

  for (const row of frame.rows) {
    const amount = vi === -1 ? 1 : toNumber(row[vi]) * scale;
    let key = "";
    let siblings = roots;

    for (const ci of levels) {
      const name = String(row[ci] ?? "—");
      // A null byte cannot appear in a column value, so it is safe as the
      // separator that keeps "a/b" and "a" + "/b" from colliding.
      key += `\u0000${name}`;
      let node = seen.get(key);
      if (!node) {
        node = { name, value: 0, children: [] };
        seen.set(key, node);
        siblings.push(node);
      }
      node.value += amount;
      siblings = node.children;
    }
  }

  return roots;
}

type TreeNode = { name: string; value: number; children?: TreeNode[] };

/** ECharts reads an empty `children` as a branch holding nothing, not a leaf. */
function asNodes(branches: Branch[]): TreeNode[] {
  return branches.map(({ name, value, children }) =>
    children.length
      ? { name, value, children: asNodes(children) }
      : { name, value },
  );
}

function hierarchyOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const scale = measureScale(numbersAt(frame, spec.value), spec.format);
  const tree = buildTree(frame, spec.path, spec.value, scale);
  const nested = spec.path.length > 1;

  // Colour the top level explicitly. Left to itself the treemap derives
  // child colours by pushing saturation, which turns a pastel palette into
  // a saturated one — the branches came out royal blue and olive.
  const data = asNodes(tree).map((node, i) => ({
    ...node,
    itemStyle: { color: PALETTE[i % PALETTE.length] },
  }));

  const tooltip = {
    ...CARD,
    trigger: "item" as const,
    formatter: (params: unknown) => {
      const p = params as { name: string; value: number; color: string };
      return tip(p.name, [
        { label: "Value", value: formatValue(p.value, spec.format), color: p.color },
      ]);
    },
  };

  if (spec.type === "sunburst") {
    return {
      baseOption: {
        ...BASE,
        tooltip,
        series: [
          {
            id: "wedges",
            type: "sunburst" as const,
            data,
            // Short of 100% so a label on the outer ring has somewhere to
            // go; at 92% the long ones were drawn past the panel edge.
            radius: ["16%", "76%"],
            center: ["50%", "50%"],
            // Keep the query's ordering; re-sorting by size hides whatever
            // the ORDER BY was trying to say.
            sort: undefined,
            itemStyle: { borderColor: PAPER, borderWidth: 2, borderRadius: 3 },
            label: {
              color: INK,
              fontSize: 10,
              fontWeight: 500,
              // A wedge too thin to hold its name is better left to the
              // tooltip than labelled with something unreadable.
              minAngle: 16,
              width: 64,
              overflow: "truncate" as const,
            },
            emphasis: { focus: "ancestor" as const },
            blur: { itemStyle: { opacity: 0.3 } },
            animationDelay: (idx: number) => idx * 26,
            universalTransition: { enabled: true, divideShape: "clone" as const },
          },
        ],
      },
      media: [
        { query: { maxWidth: NARROW }, option: { series: [{ label: { show: false } }] } },
        { option: { series: [{ label: { show: true } }] } },
      ],
    };
  }

  return {
    baseOption: {
      ...BASE,
      tooltip,
      series: [
        {
          id: "blocks",
          type: "treemap" as const,
          data,
          top: 2,
          left: 2,
          right: 2,
          bottom: 2,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          // A nested treemap needs a strip to name the parent; a flat one
          // would just be wasting the space.
          upperLabel: nested
            ? { show: true, height: 18, color: MUTED, fontSize: 10, fontWeight: 600 }
            : { show: false },
          label: {
            show: true,
            color: INK,
            fontSize: 11,
            fontWeight: 600,
            overflow: "truncate" as const,
          },
          itemStyle: { borderColor: PAPER, borderWidth: 2, borderRadius: 4, gapWidth: 2 },
          levels: [
            { itemStyle: { gapWidth: 3, borderWidth: 3, borderColor: PAPER } },
            // Vary how much of the parent's colour each child gets, rather
            // than its saturation, so the hue stays where the palette put it.
            {
              colorAlpha: [0.45, 0.95],
              itemStyle: { gapWidth: 1, borderWidth: 1, borderColor: PAPER },
            },
          ],
          emphasis: { focus: "descendant" as const },
          blur: { itemStyle: { opacity: 0.35 } },
          animationDelay: (idx: number) => idx * 24,
          universalTransition: { enabled: true, divideShape: "clone" as const },
        },
      ],
    },
    media: [
      { query: { maxWidth: NARROW }, option: { series: [{ label: { fontSize: 10 } }] } },
      { option: { series: [{ label: { fontSize: 11 } }] } },
    ],
  };
}

/**
 * Whether following the links ever arrives back where it started.
 *
 * ECharts throws rather than draws on a cyclic sankey, and a cycle is easy
 * to produce by accident — any clickstream where a visitor goes back to a
 * page they came from has one.
 */
function hasCycle(links: { source: string; target: string }[]): boolean {
  const out = new Map<string, string[]>();
  for (const { source, target } of links) {
    out.set(source, [...(out.get(source) ?? []), target]);
  }

  const state = new Map<string, 1 | 2>();
  const walk = (node: string): boolean => {
    const seen = state.get(node);
    if (seen === 1) return true;
    if (seen === 2) return false;
    state.set(node, 1);
    for (const next of out.get(node) ?? []) {
      if (walk(next)) return true;
    }
    state.set(node, 2);
    return false;
  };

  return [...out.keys()].some(walk);
}

function sankeyOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const si = indexOf(frame, spec.source);
  const ti = indexOf(frame, spec.target);
  const vi = indexOf(frame, spec.value);
  const scale = measureScale(numbersAt(frame, spec.value), spec.format);

  let links = frame.rows
    .map((row) => ({
      source: String(row[si] ?? "—"),
      target: String(row[ti] ?? "—"),
      value: toNumber(row[vi]) * scale,
    }))
    .filter((link) => link.value > 0);

  if (hasCycle(links)) {
    // Split every destination into its own node so the graph becomes two
    // columns and the cycle disappears. A zero-width space keeps the key
    // distinct while the label still reads as the plain name.
    links = links.map((link) => ({ ...link, target: `${link.target}\u200b` }));
  }

  const names = unique(links.flatMap((link) => [link.source, link.target]));
  const sources = new Set(links.map((link) => link.source));

  const nodes = names.map((name, i) => ({
    name,
    itemStyle: { color: PALETTE[i % PALETTE.length], borderWidth: 0 },
    // Labels sit to the right of their node, which runs a final column's
    // names off the edge of the panel. Anything nothing flows out of is a
    // final column, so its name goes on the inside instead.
    label: sources.has(name) ? undefined : { position: "left" as const },
  }));

  const clean = (name: string) => name.replace(/\u200b/g, "");

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as {
            dataType: string;
            name: string;
            value: number;
            data: { source?: string; target?: string; value?: number };
            color: string;
          };
          if (p.dataType === "edge") {
            return tip(`${clean(p.data.source ?? "")} → ${clean(p.data.target ?? "")}`, [
              { label: "Flow", value: formatValue(toNumber(p.data.value), spec.format) },
            ]);
          }
          return tip(clean(p.name), [
            { label: "Total", value: formatValue(p.value, spec.format), color: p.color },
          ]);
        },
      },
      series: [
        {
          id: "flows",
          type: "sankey" as const,
          data: nodes,
          links,
          top: 8,
          bottom: 8,
          left: 6,
          right: 6,
          nodeWidth: 12,
          nodeGap: 9,
          nodeAlign: "justify" as const,
          draggable: false,
          label: {
            color: INK,
            fontSize: 10,
            fontWeight: 500,
            formatter: (p: { name: string }) => clean(p.name),
          },
          itemStyle: { borderWidth: 0, borderRadius: 2 },
          // A gradient makes a ribbon read as going from one place to
          // another rather than just connecting them.
          lineStyle: { color: "gradient" as const, curveness: 0.5, opacity: 0.34 },
          emphasis: { focus: "adjacency" as const, lineStyle: { opacity: 0.6 } },
          blur: { itemStyle: { opacity: 0.25 }, lineStyle: { opacity: 0.05 } },
        },
      ],
    },
    media: [
      { query: { maxWidth: NARROW }, option: { series: [{ label: { show: false } }] } },
      { option: { series: [{ label: { show: true } }] } },
    ],
  };
}

/** Linear-interpolated quantile, the same convention as numpy's default. */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * The spread of a measure within each category.
 *
 * The query hands over raw observations and the five-number summary is
 * worked out here, because asking a model to write a median in SQL — let
 * alone a 1.5-IQR whisker — is a good way to get a chart that is subtly
 * wrong and looks fine.
 */
function boxplotOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const xi = indexOf(frame, spec.x);
  const yi = frame.columns.indexOf(spec.y[0] ?? "");
  const scale = measureScale(numbersAt(frame, spec.y[0] ?? null), spec.format);

  const groups = new Map<string, number[]>();
  for (const row of frame.rows) {
    const key = String(row[xi] ?? "—");
    const bucket = groups.get(key);
    const observation = toNumber(row[yi]) * scale;
    if (bucket) bucket.push(observation);
    else groups.set(key, [observation]);
  }

  const categories = [...groups.keys()];
  const boxes: number[][] = [];
  const outliers: [number, number][] = [];

  categories.forEach((name, i) => {
    const sorted = (groups.get(name) ?? []).slice().sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const median = quantile(sorted, 0.5);
    const q3 = quantile(sorted, 0.75);
    const reach = 1.5 * (q3 - q1);

    // Whiskers stop at the furthest observation still within 1.5 IQR, not
    // at the fence itself, so they always land on a value that exists.
    const inside = sorted.filter((v) => v >= q1 - reach && v <= q3 + reach);
    const low = inside.length ? inside[0] : (sorted[0] ?? 0);
    const high = inside.length ? inside[inside.length - 1] : (sorted[sorted.length - 1] ?? 0);

    boxes.push([low, q1, median, q3, high]);
    for (const v of sorted) {
      if (v < low || v > high) outliers.push([i, v]);
    }
  });

  const axisLabel = { color: MUTED, fontSize: 11, fontWeight: 500, hideOverlap: true };
  const tone = TONES.blue;

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as { seriesId: string; name: string; value: number[]; dataIndex: number };
          const show = (v: number) => formatValue(v, spec.format);
          if (p.seriesId === "outliers") {
            return tip(categories[p.value[0]] ?? "", [
              { label: "Outlier", value: show(p.value[1]) },
            ]);
          }
          // A boxplot's value arrives with the category index in front.
          const [, low, q1, median, q3, high] = p.value;
          return tip(categories[p.dataIndex] ?? "", [
            { label: "Max", value: show(high) },
            { label: "Upper quartile", value: show(q3) },
            { label: "Median", value: show(median) },
            { label: "Lower quartile", value: show(q1) },
            { label: "Min", value: show(low) },
          ]);
        },
      },
      grid: { left: 4, right: 10, bottom: 0, top: 10, containLabel: true },
      xAxis: {
        type: "category" as const,
        data: categories,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          ...axisLabel,
          // Offer every category and let hideOverlap decide. On its own the
          // axis thins labels by counting them, so six categories with room
          // to spare still came out showing every other one.
          interval: 0,
          formatter: (v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v),
        },
      },
      yAxis: {
        type: "value" as const,
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: LINE, type: [3, 6] as [number, number] } },
        axisLabel: { ...axisLabel, formatter: (v: number) => formatValue(v, spec.format) },
      },
      series: [
        {
          id: "spread",
          type: "boxplot" as const,
          data: boxes,
          boxWidth: [12, 48] as [number, number],
          itemStyle: {
            color: fade(tone, 0.9, 0.5),
            borderColor: darken(tone),
            borderWidth: 1.4,
          },
          emphasis: {
            focus: "series" as const,
            itemStyle: { borderWidth: 2, shadowBlur: 12, shadowColor: rgba(INK, 0.15) },
          },
          blur: { itemStyle: { opacity: 0.3 } },
          animationDelay: (idx: number) => idx * 70,
        },
        {
          id: "outliers",
          type: "scatter" as const,
          data: outliers,
          symbolSize: 5,
          itemStyle: {
            color: rgba(TONES.purple, 0.5),
            borderColor: darken(TONES.purple),
            borderWidth: 1,
          },
          emphasis: { scale: 1.6 },
          blur: { itemStyle: { opacity: 0.12 } },
          animationDelay: () => 260,
        },
      ],
    },
    media: [
      { query: { maxWidth: NARROW }, option: { xAxis: { axisLabel: { fontSize: 10 } }, yAxis: { axisLabel: { fontSize: 10 } } } },
      { option: { xAxis: { axisLabel: { fontSize: 11 } }, yAxis: { axisLabel: { fontSize: 11 } } } },
    ],
  };
}

/** A measure by country, shaded on the world map. */
function mapOption(frame: Frame, spec: PanelSpec, atlas?: WorldAtlas): EChartsOption {
  const xi = indexOf(frame, spec.x);
  const vi = indexOf(frame, spec.value);
  const scale = measureScale(numbersAt(frame, spec.value), spec.format);

  const data: { name: string; value: number }[] = [];
  let unplaced = 0;

  for (const row of frame.rows) {
    const name = atlas ? resolvePlace(atlas, row[xi]) : undefined;
    if (!name) {
      unplaced += 1;
      continue;
    }
    data.push({ name, value: toNumber(row[vi]) * scale });
  }

  const values = data.map((d) => d.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        // A short tile puts the cursor near the edge; without this the
        // card paints off the panel and looks like hover is broken.
        confine: true,
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number };
          return tip(p.name, [
            {
              label: "Value",
              // Hovering a country the query said nothing about should say
              // so, not read as a zero.
              value: Number.isFinite(p.value) ? formatValue(p.value, spec.format) : "No data",
            },
          ]);
        },
      },
      // `calculable` puts drag handles on the key. On a short tile those
      // handles sit on the map and eat every mousemove, which is why hover
      // and pan die as soon as the panel shrinks. The key is a legend here,
      // not a filter.
      visualMap: {
        ...shadeScale(min, max, spec.format),
        calculable: false,
        hoverLink: false,
      },
      // Territories too small to appear at this resolution are dropped, and
      // a choropleth that quietly loses rows is worse than one that admits it.
      graphic: unplaced
        ? [
            {
              type: "text" as const,
              right: 2,
              top: 2,
              silent: true,
              style: {
                text: `${unplaced} not on the map`,
                fill: FAINT,
                fontSize: 10,
                fontFamily: "inherit",
              },
            },
          ]
        : [],
      series: [
        {
          id: "places",
          type: "map" as const,
          map: WORLD_MAP,
          data,
          roam: false,
          top: 2,
          bottom: 40,
          // Two corrections, both about filling the panel. ECharts defaults
          // to squeezing longitude by a quarter, a convention from its
          // China maps that leaves a world map narrow; and cropping the
          // empty latitudes below Tierra del Fuego and above the Arctic
          // removes a third of the height that never holds a country.
          aspectScale: 1,
          boundingCoords: [
            [-180, 83],
            [180, -56],
          ] as [[number, number], [number, number]],
          scaleLimit: { min: 0.8, max: 6 },
          selectedMode: false as const,
          label: { show: false },
          itemStyle: { areaColor: "#f4f4f5", borderColor: PAPER, borderWidth: 0.8 },
          emphasis: {
            label: { show: false },
            itemStyle: { areaColor: TONES.yellow, borderColor: INK, borderWidth: 1 },
          },
        },
      ],
    },
    media: [
      {
        // A 13-rem row at the 900px breakpoint is ~150px of chart. The
        // world map is cropped to fill that box, so without roam the
        // pointer can only see a strip of ocean.
        query: { maxHeight: 260 },
        option: {
          visualMap: { itemHeight: 88, calculable: false },
          series: [{ roam: true, top: 2, bottom: 26 }],
        },
      },
      {
        query: { maxWidth: NARROW },
        option: {
          visualMap: { itemHeight: 96, calculable: false },
          series: [{ roam: true, top: 2, bottom: 28 }],
        },
      },
      {
        option: {
          visualMap: { itemHeight: 180, calculable: false },
          series: [{ roam: false, top: 2, bottom: 40 }],
        },
      },
    ],
  };
}

function radarOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const names = columnAt(frame, spec.x).map(String);
  const measures = spec.y;
  const columns = measures.map((column) => {
    const raw = numbersAt(frame, column);
    const scale = measureScale(raw, spec.format);
    return raw.map((v) => v * scale);
  });

  const indicators = measures.map((name, i) => {
    const peak = columns[i].length ? Math.max(0, ...columns[i]) : 0;
    return { name, max: peak > 0 ? peak * 1.08 : 1 };
  });

  const data = names.map((name, row) => {
    const tone = PALETTE[row % PALETTE.length];
    return {
      name,
      value: measures.map((_, i) => columns[i][row] ?? 0),
      itemStyle: { color: tone },
      lineStyle: { color: darken(tone), width: 1.8 },
      areaStyle: { color: rgba(tone, names.length > 2 ? 0.1 : 0.2) },
    };
  });

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number[]; color: string };
          return tip(
            p.name,
            measures.map((measure, i) => ({
              label: measure,
              value: formatValue(p.value[i] ?? 0, spec.format),
              color: p.color,
            })),
          );
        },
      },
      legend: legend(names.length > 1),
      radar: {
        indicator: indicators,
        center: ["50%", names.length > 1 ? "56%" : "50%"],
        radius: "62%",
        startAngle: 90,
        shape: "polygon" as const,
        splitNumber: 4,
        axisName: { color: MUTED, fontSize: 10, fontWeight: 500 },
        splitLine: { lineStyle: { color: LINE, type: [3, 6] as [number, number] } },
        splitArea: { areaStyle: { color: [PAPER, rgba(TONES.gray, 0.35)] } },
        axisLine: { lineStyle: { color: LINE } },
      },
      series: [
        {
          id: "spokes",
          type: "radar" as const,
          data,
          symbol: "circle",
          symbolSize: 6,
          animationDelay: (idx: number) => idx * 80,
          emphasis: { focus: "self" as const, lineStyle: { width: 2.4 } },
          blur: { lineStyle: { opacity: 0.12 }, areaStyle: { opacity: 0.04 } },
        },
      ],
    },
    media: [
      {
        query: { maxWidth: NARROW },
        option: {
          radar: { radius: "48%", axisName: { fontSize: 9 } },
          legend: { textStyle: { fontSize: 10 } },
        },
      },
      {
        option: {
          radar: { radius: "62%", axisName: { fontSize: 10 } },
          legend: { textStyle: { fontSize: 11 } },
        },
      },
    ],
  };
}

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  for (const step of steps) {
    if (value <= step * pow) return step * pow;
  }
  return 10 * pow;
}

function gaugeOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const raw = numbersAt(frame, spec.y[0] ?? null)[0] ?? 0;
  const scale = measureScale([raw], spec.format);
  const shown = raw * scale;
  const max = spec.format === "percent" ? 100 : niceCeiling(shown * 1.15);
  const tone = TONES.blue;

  return {
    ...BASE,
    tooltip: { show: false },
    series: [
      {
        id: "dial",
        type: "gauge" as const,
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max,
        center: ["50%", "58%"],
        radius: "92%",
        progress: {
          show: true,
          width: 16,
          roundCap: true,
          itemStyle: { color: fade(tone, 0.95, 0.55) },
        },
        pointer: { show: false },
        axisLine: { roundCap: true, lineStyle: { width: 16, color: [[1, LINE]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, "4%"],
          fontSize: 28,
          fontWeight: 600,
          color: INK,
          fontFamily: "inherit",
          formatter: (v: number) => formatValue(v, spec.format),
        },
        data: [{ value: shown }],
        animationDuration: ENTER_MS,
        animationEasing: "cubicOut" as const,
      },
    ],
  };
}

function graphOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const si = indexOf(frame, spec.source);
  const ti = indexOf(frame, spec.target);
  const vi = indexOf(frame, spec.value);
  const scale = vi === -1 ? 1 : measureScale(numbersAt(frame, spec.value), spec.format);

  const links = frame.rows
    .map((row) => ({
      source: String(row[si] ?? "—"),
      target: String(row[ti] ?? "—"),
      value: (vi === -1 ? 1 : toNumber(row[vi])) * scale,
    }))
    .filter((link) => link.source && link.target && link.value > 0);

  const names = unique(links.flatMap((link) => [link.source, link.target]));
  const peak = links.reduce((m, link) => Math.max(m, link.value), 1);

  const nodes = names.map((name, i) => {
    const weight = links
      .filter((link) => link.source === name || link.target === name)
      .reduce((sum, link) => sum + link.value, 0);
    return {
      name,
      value: weight,
      symbolSize: 16 + (28 * weight) / (peak * Math.max(names.length, 1)),
      itemStyle: {
        color: PALETTE[i % PALETTE.length],
        borderColor: PAPER,
        borderWidth: 2,
      },
      label: {
        show: true,
        color: INK,
        fontSize: 10,
        fontWeight: 600,
        formatter: name.length > 14 ? `${name.slice(0, 13)}…` : name,
      },
    };
  });

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as {
            dataType: string;
            name: string;
            value: number;
            data: { source?: string; target?: string; value?: number };
            color: string;
          };
          if (p.dataType === "edge") {
            return tip(`${p.data.source ?? ""} → ${p.data.target ?? ""}`, [
              { label: "Weight", value: formatValue(toNumber(p.data.value), spec.format) },
            ]);
          }
          return tip(p.name, [
            { label: "Total", value: formatValue(p.value, spec.format), color: p.color },
          ]);
        },
      },
      series: [
        {
          id: "net",
          type: "graph" as const,
          // Force layout walks off a tile. Circular stays inside the panel
          // and still reads as a network once the ribbons have a curve.
          layout: "circular" as const,
          circular: { rotateLabel: false },
          data: nodes,
          links: links.map((link) => {
            const src = names.indexOf(link.source);
            const tone = PALETTE[(src < 0 ? 0 : src) % PALETTE.length];
            return {
              ...link,
              lineStyle: {
                color: rgba(tone, 0.28 + 0.4 * (link.value / peak)),
                width: 1.2 + (3.5 * link.value) / peak,
                curveness: 0.32,
              },
            };
          }),
          roam: false,
          draggable: false,
          top: 18,
          bottom: 18,
          left: 56,
          right: 56,
          label: { show: true, fontSize: 10, fontWeight: 600, color: INK },
          itemStyle: { borderWidth: 0 },
          emphasis: { focus: "adjacency" as const, lineStyle: { width: 5, opacity: 0.85 } },
          blur: { itemStyle: { opacity: 0.18 }, lineStyle: { opacity: 0.05 } },
        },
      ],
    },
    media: [
      { query: { maxWidth: NARROW }, option: { series: [{ label: { show: false } }] } },
      { option: { series: [{ label: { show: true } }] } },
    ],
  };
}

function treeOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const scale = spec.value
    ? measureScale(numbersAt(frame, spec.value), spec.format)
    : 1;
  const branches = asNodes(buildTree(frame, spec.path, spec.value, scale));
  const data =
    branches.length === 1
      ? branches
      : [{ name: "", value: branches.reduce((s, b) => s + b.value, 0), children: branches }];

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number };
          if (!p.name) return "";
          return tip(p.name, [
            { label: "Value", value: formatValue(p.value, spec.format) },
          ]);
        },
      },
      series: [
        {
          id: "nodes",
          type: "tree" as const,
          data,
          top: 10,
          bottom: 10,
          left: 16,
          right: 80,
          orient: "LR" as const,
          expandAndCollapse: false,
          initialTreeDepth: -1,
          symbol: "emptyCircle",
          symbolSize: 8,
          edgeShape: "curve" as const,
          lineStyle: { color: LINE, width: 1.2, curveness: 0.5 },
          itemStyle: { color: TONES.blue, borderColor: darken(TONES.blue), borderWidth: 1.4 },
          label: {
            color: INK,
            fontSize: 10,
            fontWeight: 500,
            position: "right" as const,
            formatter: (p: { name: string }) =>
              p.name.length > 18 ? `${p.name.slice(0, 17)}…` : p.name,
          },
          leaves: {
            label: { position: "right" as const },
            itemStyle: { color: TONES.yellow, borderColor: darken(TONES.yellow) },
          },
          animationDelay: (idx: number) => Math.min(idx * 18, STAGGER_BUDGET_MS),
          emphasis: { focus: "descendant" as const },
          blur: { itemStyle: { opacity: 0.25 }, lineStyle: { opacity: 0.15 } },
        },
      ],
    },
    media: [
      {
        query: { maxWidth: NARROW },
        option: { series: [{ right: 12, label: { show: false } }] },
      },
      { option: { series: [{ right: 80, label: { show: true } }] } },
    ],
  };
}

function themeRiverOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const xi = indexOf(frame, spec.x);
  const yi = indexOf(frame, spec.y[0] ?? null);
  const si = indexOf(frame, spec.series);
  const scale = measureScale(numbersAt(frame, spec.y[0] ?? null), spec.format);

  const data: [string, number, string][] = frame.rows.map((row) => [
    String(row[xi] ?? ""),
    toNumber(row[yi]) * scale,
    String(row[si] ?? spec.y[0] ?? ""),
  ]);

  const names = unique(data.map((row) => String(row[2])));

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "axis" as const,
        formatter: (params: unknown) => {
          const rows = Array.isArray(params) ? params : [params];
          const first = rows[0] as { value?: [string, number, string] };
          const head = String(first.value?.[0] ?? "");
          return tip(
            head,
            rows.map((row) => {
              const p = row as { value: [string, number, string]; color: string };
              return {
                label: String(p.value[2] ?? ""),
                value: formatValue(toNumber(p.value[1]), spec.format),
                color: p.color,
              };
            }),
          );
        },
      },
      legend: legend(names.length > 1),
      singleAxis: {
        type: "time" as const,
        top: names.length > 1 ? 28 : 10,
        bottom: 8,
        left: 12,
        right: 12,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: MUTED, fontSize: 11, fontWeight: 500 },
      },
      series: [
        {
          id: "streams",
          type: "themeRiver" as const,
          data,
          label: { show: false },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: rgba(INK, 0.12) } },
          blur: { itemStyle: { opacity: 0.25 } },
        },
      ],
    },
    media: [
      {
        query: { maxWidth: NARROW },
        option: { singleAxis: { axisLabel: { fontSize: 10 } } },
      },
      { option: { singleAxis: { axisLabel: { fontSize: 11 } } } },
    ],
  };
}

function chordOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const si = indexOf(frame, spec.source);
  const ti = indexOf(frame, spec.target);
  const vi = indexOf(frame, spec.value);
  const scale = measureScale(numbersAt(frame, spec.value), spec.format);

  const links = frame.rows
    .map((row) => ({
      source: String(row[si] ?? "—"),
      target: String(row[ti] ?? "—"),
      value: toNumber(row[vi]) * scale,
    }))
    .filter((link) => link.source && link.target && link.value > 0);

  const names = unique(links.flatMap((link) => [link.source, link.target]));
  const nodes = names.map((name, i) => ({
    name,
    itemStyle: { color: PALETTE[i % PALETTE.length] },
  }));

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as {
            dataType?: string;
            name: string;
            value: number;
            data: { source?: string; target?: string; value?: number };
            color: string;
          };
          if (p.data?.source && p.data?.target) {
            return tip(`${p.data.source} → ${p.data.target}`, [
              { label: "Flow", value: formatValue(toNumber(p.data.value), spec.format) },
            ]);
          }
          return tip(p.name, [
            { label: "Total", value: formatValue(p.value, spec.format), color: p.color },
          ]);
        },
      },
      series: [
        {
          id: "ribbons",
          type: "chord" as const,
          data: nodes,
          links,
          center: ["50%", "50%"],
          radius: ["48%", "70%"],
          padAngle: 2,
          startAngle: 90,
          itemStyle: { borderColor: PAPER, borderWidth: 2, borderRadius: [0, 0, 5, 5] },
          lineStyle: { color: "source" as const, opacity: 0.28 },
          label: {
            color: INK,
            fontSize: 10,
            fontWeight: 500,
            formatter: (p: { name: string }) =>
              p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name,
          },
          emphasis: { focus: "adjacency" as const, lineStyle: { opacity: 0.55 } },
          blur: { itemStyle: { opacity: 0.25 }, lineStyle: { opacity: 0.06 } },
        },
      ],
    },
    media: [
      { query: { maxWidth: NARROW }, option: { series: [{ label: { show: false }, radius: ["40%", "64%"] }] } },
      { option: { series: [{ label: { show: true }, radius: ["48%", "70%"] }] } },
    ],
  };
}

function parallelOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const names = columnAt(frame, spec.x).map(String);
  const measures = spec.y;
  const columns = measures.map((column) => {
    const raw = numbersAt(frame, column);
    const scale = measureScale(raw, spec.format);
    return raw.map((v) => v * scale);
  });

  const data = names.map((name, row) => ({
    name,
    value: measures.map((_, i) => columns[i][row] ?? 0),
    lineStyle: {
      color: PALETTE[row % PALETTE.length],
      width: 1.8,
      opacity: names.length > 8 ? 0.45 : 0.7,
    },
  }));

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number[]; color: string };
          return tip(
            p.name,
            measures.map((measure, i) => ({
              label: measure,
              value: formatValue(p.value[i] ?? 0, spec.format),
              color: p.color,
            })),
          );
        },
      },
      legend: legend(names.length > 1 && names.length <= 8),
      parallel: {
        left: 56,
        right: 24,
        top: names.length > 1 && names.length <= 8 ? 32 : 16,
        bottom: 16,
        parallelAxisDefault: {
          type: "value" as const,
          nameTextStyle: { color: MUTED, fontSize: 10, fontWeight: 500 },
          axisLine: { lineStyle: { color: LINE } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: MUTED,
            fontSize: 10,
            formatter: (v: number) => formatValue(v, spec.format),
          },
        },
      },
      parallelAxis: measures.map((name, i) => ({
        dim: i,
        name: name.length > 14 ? `${name.slice(0, 13)}…` : name,
      })),
      series: [
        {
          id: "profiles",
          type: "parallel" as const,
          data,
          smooth: true,
          emphasis: { lineStyle: { width: 2.6, opacity: 1 } },
          blur: { lineStyle: { opacity: 0.08 } },
        },
      ],
    },
    media: [
      { query: { maxWidth: NARROW }, option: { parallel: { left: 36, right: 12 } } },
      { option: { parallel: { left: 56, right: 24 } } },
    ],
  };
}

function pictorialBarOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const xs = columnAt(frame, spec.x).map(String);
  const raw = numbersAt(frame, spec.y[0] ?? null);
  const scale = measureScale(raw, spec.format);
  const values = raw.map((v) => v * scale);
  const tone = TONES.blue;
  const stroke = darken(tone);

  return {
    baseOption: {
      ...BASE,
      grid: { left: 4, right: 16, top: 10, bottom: 0, containLabel: true },
      tooltip: {
        ...tooltipCard(spec.format, 1),
        trigger: "axis" as const,
      },
      xAxis: {
        type: "category" as const,
        data: xs,
        boundaryGap: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: MUTED,
          fontSize: 11,
          fontWeight: 500,
          interval: 0,
          formatter: (v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v),
        },
      },
      yAxis: {
        type: "value" as const,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: LINE, type: [3, 6] as [number, number] } },
        axisLabel: {
          color: MUTED,
          fontSize: 11,
          formatter: (v: number) => formatValue(v, spec.format),
        },
      },
      series: [
        {
          id: "marks",
          type: "pictorialBar" as const,
          data: values,
          symbol: "roundRect",
          symbolRepeat: true,
          symbolClip: true,
          symbolMargin: 3,
          symbolSize: [18, 8],
          itemStyle: { color: fade(tone, 0.95, 0.55), borderColor: stroke, borderWidth: 0.6 },
          emphasis: { itemStyle: { color: tone } },
          animationDelay: (idx: number) => idx * 70,
        },
      ],
    },
    media: [
      {
        query: { maxWidth: NARROW },
        option: { series: [{ symbolSize: [12, 6] }], xAxis: { axisLabel: { fontSize: 10 } } },
      },
      { option: { series: [{ symbolSize: [18, 8] }], xAxis: { axisLabel: { fontSize: 11 } } } },
    ],
  };
}

function candlestickOption(frame: Frame, spec: PanelSpec): EChartsOption {
  const xs = columnAt(frame, spec.x).map(String);
  const cols = spec.y.slice(0, 4).map((column) => numbersAt(frame, column));
  const scale = measureScale(cols.flat(), spec.format);
  const data = xs.map((_, i) =>
    cols.map((column) => (column[i] ?? 0) * scale),
  );

  const axisLabel = { color: MUTED, fontSize: 11, fontWeight: 500, hideOverlap: true };

  return {
    baseOption: {
      ...BASE,
      grid: { left: 4, right: 10, top: 10, bottom: 0, containLabel: true },
      tooltip: {
        ...CARD,
        trigger: "axis" as const,
        formatter: (params: unknown) => {
          const rows = Array.isArray(params) ? params : [params];
          const p = rows[0] as { name?: string; axisValueLabel?: string; value: number[] };
          const values = Array.isArray(p.value) ? p.value : [];
          // ECharts prepends the category index on a category axis.
          const ohlc = values.length > 4 ? values.slice(1, 5) : values;
          const [open, close, low, high] = ohlc;
          const show = (v: number) => formatValue(v, spec.format);
          return tip(String(p.axisValueLabel ?? p.name ?? ""), [
            { label: "High", value: show(high) },
            { label: "Open", value: show(open) },
            { label: "Close", value: show(close) },
            { label: "Low", value: show(low) },
          ]);
        },
      },
      xAxis: {
        type: "category" as const,
        data: xs,
        boundaryGap: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { ...axisLabel, interval: 0 },
      },
      yAxis: {
        type: "value" as const,
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: LINE, type: [3, 6] as [number, number] } },
        axisLabel: { ...axisLabel, formatter: (v: number) => formatValue(v, spec.format) },
      },
      series: [
        {
          id: "range",
          type: "candlestick" as const,
          data,
          barMaxWidth: 18,
          itemStyle: {
            color: fade(TONES.green, 0.95, 0.55),
            color0: fade(TONES.purple, 0.95, 0.55),
            borderColor: darken(TONES.green),
            borderColor0: darken(TONES.purple),
            borderWidth: 1.2,
          },
          emphasis: { itemStyle: { borderWidth: 2 } },
        },
      ],
    },
    media: [
      { query: { maxWidth: NARROW }, option: { xAxis: { axisLabel: { fontSize: 10 } } } },
      { option: { xAxis: { axisLabel: { fontSize: 11 } } } },
    ],
  };
}

function linesOption(frame: Frame, spec: PanelSpec, atlas?: WorldAtlas): EChartsOption {
  const si = indexOf(frame, spec.source);
  const ti = indexOf(frame, spec.target);
  const vi = indexOf(frame, spec.value);
  const scale = measureScale(numbersAt(frame, spec.value), spec.format);

  const data: { coords: [number, number][]; value: number }[] = [];
  let unplaced = 0;

  for (const row of frame.rows) {
    const from = atlas ? resolvePlace(atlas, row[si]) : undefined;
    const to = atlas ? resolvePlace(atlas, row[ti]) : undefined;
    const a = from ? atlas?.centers[from] : undefined;
    const b = to ? atlas?.centers[to] : undefined;
    if (!a || !b) {
      unplaced += 1;
      continue;
    }
    data.push({ coords: [a, b], value: toNumber(row[vi]) * scale });
  }

  const peak = data.reduce((m, d) => Math.max(m, d.value), 1);

  return {
    baseOption: {
      ...BASE,
      tooltip: {
        ...CARD,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = params as { data?: { value?: number } };
          return tip("Flow", [
            { label: "Value", value: formatValue(toNumber(p.data?.value), spec.format) },
          ]);
        },
      },
      geo: {
        map: WORLD_MAP,
        roam: false,
        top: 4,
        bottom: 8,
        aspectScale: 1,
        boundingCoords: [
          [-180, 83],
          [180, -56],
        ] as [[number, number], [number, number]],
        silent: true,
        itemStyle: { areaColor: "#f4f4f5", borderColor: PAPER, borderWidth: 0.8 },
        emphasis: { disabled: true },
      },
      graphic: unplaced
        ? [
            {
              type: "text" as const,
              right: 2,
              top: 2,
              silent: true,
              style: {
                text: `${unplaced} not on the map`,
                fill: FAINT,
                fontSize: 10,
                fontFamily: "inherit",
              },
            },
          ]
        : [],
      series: [
        {
          id: "arcs",
          type: "lines" as const,
          coordinateSystem: "geo" as const,
          data,
          polyline: false,
          lineStyle: {
            color: TONES.blue,
            width: 1.2,
            opacity: 0.45,
            curveness: 0.22,
          },
          effect: {
            show: true,
            period: 4,
            trailLength: 0.35,
            symbol: "circle",
            symbolSize: 3.5,
            color: darken(TONES.blue),
          },
          emphasis: { lineStyle: { width: 2.2, opacity: 0.85 } },
          blur: { lineStyle: { opacity: 0.08 } },
        },
        {
          id: "ends",
          type: "effectScatter" as const,
          coordinateSystem: "geo" as const,
          data: data.flatMap((d) => [
            { value: [...d.coords[0], d.value] },
            { value: [...d.coords[1], d.value] },
          ]),
          symbolSize: (v: number[]) => 4 + (8 * (v[2] ?? 0)) / peak,
          itemStyle: { color: TONES.blue, borderColor: PAPER, borderWidth: 1 },
          rippleEffect: { scale: 2.4, brushType: "stroke" as const, period: 3.6 },
          label: { show: false },
        },
      ],
    },
    media: [
      { query: { maxWidth: NARROW }, option: { geo: { top: 2, bottom: 6 } } },
      { option: { geo: { top: 4, bottom: 8 } } },
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
