import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { computeCashflow } from "@/lib/cashflow/compute";

export const dynamic = "force-dynamic";

/**
 * GET /api/cashflow — unified cashflow game-plan (read-only): four scenario lines
 * (actual / on-budget / bare-essentials / custom) each with a zero-date, the
 * next-bills verdict, and "what's coming". Optional what-if query params:
 *   cut=<0..100>  discretionary cut % (custom line)
 *   income=<$/wk> hypothetical extra weekly income
 *   lump          (presence) assume every expected inflow lands at its expected date
 * Shared contract for the finops CLI and MCP. PAT-authenticated.
 */
export const GET = withAuth(async (request, auth) => {
  const url = new URL(request.url);
  const num = (k: string) => {
    const v = url.searchParams.get(k);
    return v == null ? undefined : Number(v);
  };
  const today = new Date().toISOString().slice(0, 10);
  const lump = url.searchParams.get("lump") != null;
  const base = { supabase: auth.supabase, householdId: auth.householdId };
  const common = { addIncomeWeekly: num("income"), customCutPct: num("cut") };

  // `lump` lands ALL expected inflows; their ids aren't known until the first
  // compute, so derive the per-inflow land dates from r0.inflows, then recompute.
  const r0 = await computeCashflow({ ...base, toggles: common });
  const lumps = lump
    ? Object.fromEntries(r0.inflows.map((i) => [i.id, i.expectedDate ?? today]))
    : undefined;
  const result = lumps
    ? await computeCashflow({ ...base, toggles: { ...common, lumps } })
    : r0;
  return NextResponse.json(result);
});
