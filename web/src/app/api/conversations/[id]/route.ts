import { NextRequest, NextResponse } from "next/server";

import { BACKEND_URL } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

async function proxy(
  id: string,
  init?: { method: string; body?: string },
): Promise<NextResponse> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/conversations/${id}`, {
      cache: "no-store",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      ...init,
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}

/** One thread, replayed: the messages, not the tool calls behind them. */
export async function GET(_req: NextRequest, { params }: Params) {
  return proxy((await params).id);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return proxy((await params).id, { method: "PATCH", body: await req.text() });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  return proxy((await params).id, { method: "DELETE" });
}
