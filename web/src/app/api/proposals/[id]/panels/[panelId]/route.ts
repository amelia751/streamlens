import { NextRequest, NextResponse } from "next/server";

import { BACKEND_URL } from "@/lib/api";

const ID = /^[A-Za-z0-9_-]+$/;

/**
 * The rows behind one chart on a proposal.
 *
 * The browser sends two identifiers and no SQL. The backend replays the
 * proposal's own stored copy of the query — not the dashboard's, which may
 * since have been edited or deleted.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; panelId: string }> },
) {
  const { id, panelId } = await ctx.params;
  if (!ID.test(id) || !ID.test(panelId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/proposals/${id}/panels/${panelId}`,
      { cache: "no-store", signal: req.signal },
    );
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    if (req.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
