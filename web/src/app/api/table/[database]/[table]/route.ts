import { NextRequest, NextResponse } from "next/server";

import { BACKEND_URL } from "@/lib/api";

/**
 * Proxy from the browser to one table in the warehouse.
 *
 * Exists so the backend can stay private while a client component fetches.
 * Only an identifier crosses the boundary — never SQL — and the backend
 * checks it against `system.tables` before it reaches a query.
 */
const IDENTIFIER = /^[A-Za-z0-9_]+$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ database: string; table: string }> },
) {
  const { database, table } = await ctx.params;

  if (!IDENTIFIER.test(database) || !IDENTIFIER.test(table)) {
    return NextResponse.json({ error: "bad identifier" }, { status: 400 });
  }

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), 1000)
    : 200;

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/table/${database}/${table}?limit=${safeLimit}`,
      { next: { revalidate: 60 } },
    );
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
