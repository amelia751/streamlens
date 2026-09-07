import { NextRequest, NextResponse } from "next/server";

import { BACKEND_URL } from "@/lib/api";

const ID = /^[A-Za-z0-9_-]+$/;

/** One proposal: the document, the panels it owns, and its stills. */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!ID.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/proposals/${id}`, {
      cache: "no-store",
      signal: req.signal,
    });
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

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!ID.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/proposals/${id}`, {
      method: "DELETE",
      cache: "no-store",
      signal: req.signal,
    });
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
