/**
 * Access to the Streamlens backend.
 *
 * The browser holds no ClickHouse credentials and no Cloud API key. It asks
 * the backend, which reads the live instance.
 */

export const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export type Stream = {
  name: string;
  state: string;
  database: string;
  table: string;
  rows: number;
};

export type SourceVendor = "gcs" | "s3" | "azure";

export type Source = {
  id: string;
  mechanism: string;
  vendor?: SourceVendor | null;
  label: string;
  state: string;
  detail: string;
  rows: number;
  last_sync?: string | null;
  streams: Stream[];
};

export type Table = {
  name: string;
  engine: string;
  rows: number;
  bytes: number;
  kind: "data" | "errors" | "view";
};

export type Database = {
  name: string;
  rows: number;
  table_count: number;
  tables: Table[];
};

export type Warehouse = {
  service: { name: string; version: string };
  sources: Source[];
  databases: Database[];
};

export type Column = {
  name: string;
  type: string;
};

export type TablePreview = {
  database: string;
  table: string;
  engine: string;
  total_rows: number;
  columns: Column[];
  rows: unknown[][];
  limit: number;
};

/**
 * Mirrors the backend chart registry in `dashboards/charts.py`.
 *
 * Adding a member here without a branch in the panel renderer is a build
 * error, which is the point — see the switch in `components/panel.tsx`.
 */
export type ChartType =
  | "line"
  | "bar"
  | "area"
  | "scatter"
  | "pie"
  | "funnel"
  | "heatmap"
  | "calendar"
  | "treemap"
  | "sunburst"
  | "sankey"
  | "boxplot"
  | "map"
  | "radar"
  | "gauge"
  | "graph"
  | "tree"
  | "themeRiver"
  | "chord"
  | "parallel"
  | "pictorialBar"
  | "effectScatter"
  | "candlestick"
  | "lines"
  | "table"
  | "stat";

export type ValueFormat =
  | "number"
  | "compact"
  | "percent"
  | "bytes"
  | "duration"
  | "currency";

/**
 * What a panel means. The renderer decides how it looks.
 *
 * Which channels matter is a property of `type`: a heatmap reads x, y and
 * value, a sankey reads source, target and value. Panels saved before a
 * channel existed simply leave it unset.
 */
export type PanelSpec = {
  type: ChartType;
  x: string | null;
  y: string[];
  series: string | null;
  value: string | null;
  path: string[];
  source: string | null;
  target: string | null;
  stacked: boolean;
  format: ValueFormat;
};

/**
 * Everything the renderer needs to draw a panel, and nothing about who
 * owns it.
 *
 * A dashboard panel and a proposal's own copy of one are stored in
 * different tables and fetched from different routes, but they draw
 * identically. `PanelCard` takes this and a URL to pull rows from, so
 * there is one renderer rather than one per owner.
 */
export type PanelView = {
  id: string;
  title: string;
  spec: PanelSpec;
  width: number;
  height: number;
};

export type Panel = PanelView & {
  dashboard_id: string;
  query: string;
  position: number;
};

export type Dashboard = {
  id: string;
  title: string;
  description: string;
  panels: Panel[];
};

export type DashboardSummary = {
  id: string;
  title: string;
  description: string;
  panel_count: number;
};

export type PanelData = {
  panel: PanelView;
  columns: string[];
  types: string[];
  rows: unknown[][];
};

export async function fetchDashboards(): Promise<DashboardSummary[]> {
  const res = await fetch(`${BACKEND_URL}/api/dashboards`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`dashboards ${res.status}: ${await res.text()}`);
  }
  return (await res.json()).dashboards;
}

export type Row = Record<string, unknown>;

export type QueryResult = {
  name: string;
  columns: string[];
  rows: Row[];
  row_count: number;
};

export type QueryParams = Record<string, string | number | undefined>;

export async function runQuery(
  name: string,
  params: QueryParams = {},
  revalidate = 60,
): Promise<QueryResult> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, String(v));
  }
  const qs = search.toString();
  const url = `${BACKEND_URL}/api/query/${name}${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, { next: { revalidate } });
  if (!res.ok) {
    throw new Error(
      `query ${name} failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  return res.json();
}

/** Same call from a client component, via the Next route handler. */
export async function fetchQuery(
  name: string,
  params: QueryParams = {},
): Promise<QueryResult> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, String(v));
  }
  const qs = search.toString();
  const res = await fetch(`/api/q/${name}${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`query ${name} failed: ${res.status}`);
  return res.json();
}

export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export function compact(v: unknown): string {
  const n = num(v);
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}

export function commas(v: unknown): string {
  return num(v).toLocaleString("en-US");
}

export type TitleArtwork = {
  title: string;
  tmdb_id: number | null;
  media_type: string | null;
  year: string | null;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  vote_average: number | null;
};

export async function fetchArtwork(title: string): Promise<TitleArtwork> {
  const res = await fetch(`/api/artwork?title=${encodeURIComponent(title)}`);
  if (!res.ok) {
    return {
      title,
      tmdb_id: null,
      media_type: null,
      year: null,
      overview: null,
      poster_url: null,
      backdrop_url: null,
      vote_average: null,
    };
  }
  return res.json();
}

export async function fetchWarehouse(): Promise<Warehouse> {
  const res = await fetch(`${BACKEND_URL}/api/warehouse`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`warehouse ${res.status}: ${await res.text()}`);
  }
  return res.json();
}
