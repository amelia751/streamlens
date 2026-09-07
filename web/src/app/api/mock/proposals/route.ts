import { NextResponse } from "next/server";

import { listProposals } from "@/mock/proposals";

/** Theme proposals. Backed by `src/mock` until a real store exists. */
export async function GET() {
  return NextResponse.json({ proposals: listProposals() });
}
