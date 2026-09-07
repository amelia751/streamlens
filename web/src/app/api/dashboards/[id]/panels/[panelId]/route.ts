import { NextRequest, NextResponse } from "next/server";

import { BACKEND_URL } from "@/lib/api";

const ID = /^[A-Za-z0-9_-]+$/;

/**
 * The rows behind one panel.
 *
 * The browser sends two identifiers and no SQL. The backend replays the
 * query that was stored with the panel, so what renders here is the query
 * that was validated when the panel was saved.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; panelId: string }> },
) {
  const { id, panelId } = await ctx.params;
  if (!ID.test(id) || !ID.test(panelId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/dashboards/${id}/panels/${panelId}/data`,
      { cache: "no-store" },
    );
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
