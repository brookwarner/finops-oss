import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { getCachedInvestments } from "@/lib/holdings/cached";
import { summarisePortfolio } from "@/lib/holdings/group";

export const dynamic = "force-dynamic";

/**
 * GET /api/investments — investment/KiwiSaver holdings grouped by account, with
 * cumulative + annualised (CAGR) returns, plus a whole-portfolio roll-up. Shared
 * contract for the `finops` CLI and the `get_holdings` MCP tool. PAT-authenticated.
 */
export const GET = withAuth(async (_request, auth) => {
  const accounts = await getCachedInvestments(auth.householdId);
  return NextResponse.json({ accounts, portfolio: summarisePortfolio(accounts) });
});
