import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { computeEmergencyFund } from "@/lib/buffer/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/buffer — emergency-fund (cash buffer) state: target (N months of
 * essential spend), the designated account's balance, shortfall, months covered,
 * and % funded. Read-only, PAT-authenticated; shared contract for the CLI + MCP.
 * Returns `configured: false` (with the would-be target) when no account is
 * designated as the emergency fund.
 */
export const GET = withAuth(async (_request, auth) => {
  const r = await computeEmergencyFund({ supabase: auth.supabase, householdId: auth.householdId });
  return NextResponse.json(r);
});
