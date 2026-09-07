import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/api";

/**
 * Proxy from the browser to the backend query registry.
 *
 * This exists so the backend can stay private (Cloud Run, no public ingress)
 * while client components still fetch. Only the query name and a fixed set of
 * scalar parameters cross the boundary — never SQL.
 */
const ALLOWED = new Set([
  "title",
  "week",
  "category",
  "market",
  "kind",
  "search",
  "limit",
  "min_channels",
  "min_weeks",
  "months",
]);

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;

  if (!/^[a-z0-9_]+$/.test(name)) {
    return NextResponse.json({ error: "bad query name" }, { status: 400 });
  }

  const search = new URLSearchParams();
  for (const [k, v] of req.nextUrl.searchParams) {
    if (ALLOWED.has(k) && v !== "") search.set(k, v);
  }
  const qs = search.toString();

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/query/${name}${qs ? `?${qs}` : ""}`,
      { next: { revalidate: 60 } },
    );
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
