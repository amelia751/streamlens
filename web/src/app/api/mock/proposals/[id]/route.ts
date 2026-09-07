import { NextRequest, NextResponse } from "next/server";

import { getProposal } from "@/mock/proposals";

const ID = /^[A-Za-z0-9_-]+$/;

/** One theme proposal. Backed by `src/mock` until a real store exists. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!ID.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const proposal = getProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(proposal);
}
