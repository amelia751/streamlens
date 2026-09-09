import { NextRequest, NextResponse } from "next/server";

import { BACKEND_URL } from "@/lib/api";

/**
 * One turn with the analyst, passed straight through as server-sent events.
 *
 * The body is streamed rather than awaited: a turn can run for a minute
 * while the agent explores the schema, and the point of the activity lines
 * is that they arrive during that minute rather than after it.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.text();

  try {
    const upstream = await fetch(`${BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // Node's fetch buffers the whole response without this.
      // @ts-expect-error -- duplex is not in the TS lib types yet.
      duplex: "half",
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
