import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { getCachedNetWorth } from "@/lib/networth/cached";

export const dynamic = "force-dynamic";

/**
 * GET /api/net-worth — total assets minus liabilities across all accounts.
 * Shared contract for the `finops` CLI. PAT-authenticated.
 */
export const GET = withAuth(async (_request, auth) => {
  const result = await getCachedNetWorth(auth.householdId);
  return NextResponse.json(result);
});
