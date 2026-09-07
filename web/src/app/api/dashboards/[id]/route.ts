import { NextRequest, NextResponse } from "next/server";

import { BACKEND_URL } from "@/lib/api";

const ID = /^[A-Za-z0-9_-]+$/;

/** One dashboard and its panels. Never cached — the agent edits it live. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!ID.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/dashboards/${id}`, {
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

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!ID.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/dashboards/${id}`, {
      method: "DELETE",
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
