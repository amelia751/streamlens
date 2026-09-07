import { NextRequest, NextResponse } from "next/server";
import { BACKEND_URL } from "@/lib/api";

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get("title");
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/title/artwork?title=${encodeURIComponent(title)}`,
      { next: { revalidate: 3600 } },
    );
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}
