import { NextResponse } from "next/server";

import { BACKEND_URL } from "@/lib/api";

/**
 * The saved threads with the analyst, for the tab strip and the Saved panel.
 *
 * There is no POST: a conversation is written by its first turn, so clicking
 * "new" costs nothing and leaves nothing behind.
 */
export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/conversations`, {
      cache: "no-store",
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
