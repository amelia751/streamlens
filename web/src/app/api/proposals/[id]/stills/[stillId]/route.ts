import { NextRequest, NextResponse } from "next/server";

import { BACKEND_URL } from "@/lib/api";

const ID = /^[A-Za-z0-9_-]+$/;

/**
 * One generated still, streamed through from the backend.
 *
 * The bucket enforces public access prevention and no signed URL is ever
 * minted, so this route is the only way to the bytes — which means a link
 * cannot outlive the proposal that owns it. The object at a given id never
 * changes, so the response is immutable, and private because the proposal
 * behind it is.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; stillId: string }> },
) {
  const { id, stillId } = await ctx.params;
  if (!ID.test(id) || !ID.test(stillId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/proposals/${id}/stills/${stillId}`,
      { cache: "no-store", signal: req.signal },
    );
    if (!res.ok || !res.body) {
      // Never fall through to anything that could list the bucket.
      return NextResponse.json({ error: "not found" }, { status: res.status });
    }
    return new NextResponse(res.body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "image/png",
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    if (req.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
