import { NextResponse } from "next/server";

import { BACKEND_URL } from "@/lib/api";

/** The proposals that exist, for the rail. */
export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/proposals`, {
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
