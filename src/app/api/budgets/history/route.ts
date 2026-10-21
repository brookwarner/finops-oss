import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { getHistory } from "@/lib/budgets/snapshot";

export const dynamic = "force-dynamic";

/**
 * GET /api/budgets/history — fast historical budget lookups from snapshots.
 *
 * Shared contract for the finops CLI + MCP. PAT/OAuth authenticated. Params:
 *   category   optional; case-insensitive single-category series (exact, then substring).
 *   limit      optional; number of most-recent cycles (default 6).
 *
 * With `category`: { found, category, series: [...] }.
 * Without:         { cycles: [{ period_start, period_end, budgets: [...] }] }.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? undefined;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(36, Number(limitRaw))) : undefined;

  const result = await getHistory(auth.supabase, auth.householdId, { category, limit });
  return NextResponse.json(result);
}
