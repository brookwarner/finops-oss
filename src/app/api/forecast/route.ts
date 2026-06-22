import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { computeForecast } from "@/lib/forecast/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/forecast — forward cashflow forecast for the everyday accounts.
 * Shared contract for the `finops` CLI, MCP, and PWA. PAT-authenticated.
 * Query params: horizon (days, default 30, max 90).
 */
export const GET = withAuth(async (request, auth) => {
  const { searchParams } = new URL(request.url);
  const horizonParam = Number(searchParams.get("horizon"));
  const horizonDays = Number.isFinite(horizonParam) && horizonParam > 0 ? Math.min(90, horizonParam) : undefined;

  const result = await computeForecast({
    supabase: auth.supabase,
    householdId: auth.householdId,
    horizonDays,
  });
  return NextResponse.json(result);
});
