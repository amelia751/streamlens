/**
 * Access to the Streamlens backend.
 *
 * The browser never holds ClickHouse credentials and never sends SQL. It names
 * a query from the backend registry; the backend binds the parameters and runs
 * it read-only. Server components call `runQuery` directly. Client components
 * go through /api/q/[name], which is the same call made server-side.
 */

export const BACKEND_URL =
  process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

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
  // Dashboards are read-mostly and the underlying data moves on a poll
  // schedule, so a short cache beats hammering the warehouse on every nav.
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
