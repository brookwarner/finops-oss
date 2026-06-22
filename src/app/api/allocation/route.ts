// src/app/api/allocation/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { loadAllocationInput } from "@/lib/allocation/load";
import { computeAllocation } from "@/lib/allocation/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/allocation — the surplus-allocation recommendation: ranked rungs
 * (high-interest debt → behind reserves → revolving loan → mortgage vs. investments), a one-line
 * recommendation, and the headline impact. PAT-authenticated; shared contract for
 * a future CLI/MCP surface. Read-only — never moves money.
 */
export const GET = withAuth(async (_request, auth) => {
  const input = await loadAllocationInput({ supabase: auth.supabase, householdId: auth.householdId });
  return NextResponse.json(computeAllocation(input));
});
