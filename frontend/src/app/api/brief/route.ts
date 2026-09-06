import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/api";

// The brief runs a four-step retrieval pipeline and then a Gemini call, so it
// routinely takes longer than the default serverless budget.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get("title");
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/agent/brief?title=${encodeURIComponent(title)}`,
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
