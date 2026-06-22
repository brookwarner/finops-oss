import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { getDailyBurn } from "@/lib/spend/daily-burn";

export const dynamic = "force-dynamic";

/**
 * GET /api/spend/daily-burn — actual daily burn (monthly-cap spend) for the
 * current cycle, with the planned daily figure, trailing pace, and trend.
 *
 * Shared contract for the PWA hero card, finops CLI, and MCP. PAT/OAuth authed.
 * Params: trailing — trailing-average window in days (default 7, clamped 1–31).
 * Returns: DailyBurnResult { days, plannedPerDay, trailingPerDay, vsPlan, trend, … }.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = new URL(request.url).searchParams.get("trailing");
  const parsed = raw ? Number(raw) : undefined;
  const trailingDays = Number.isFinite(parsed) ? Math.max(1, Math.min(31, parsed as number)) : undefined;

  const result = await getDailyBurn(auth.supabase, auth.householdId, { trailingDays });
  return NextResponse.json(result);
}
