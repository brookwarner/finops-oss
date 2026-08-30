import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { getIncomeHistory } from "@/lib/income/history";

export const dynamic = "force-dynamic";

/**
 * GET /api/income/history — per-cycle plan-vs-actual income, by source.
 *
 * Shared contract for the PWA card, finops CLI, and MCP. PAT/OAuth authed.
 * Params: limit — most-recent cycles (default 12, clamped 1–36).
 * Returns: { cycles: [{ period_start, period_end, total, plannedTotal, sources: [...] }] } newest-first.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limitRaw = new URL(request.url).searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const result = await getIncomeHistory(auth.supabase, auth.householdId, { limit });
  return NextResponse.json(result);
}
