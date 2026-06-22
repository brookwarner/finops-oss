import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { loadRepaymentFIBase } from "@/lib/fi/repayment-load";
import { simulateRepaymentFI } from "@/lib/fi/repayment";

export const dynamic = "force-dynamic";

/**
 * GET /api/fi/repayment?extraPerMonth=&lumpSum= — "what would increasing my
 * mortgage repayments do to my FI date?". Compares two arms drawing the same
 * total each month: keep investing the extra vs. throw it at the mortgage (which
 * clears sooner, then redirects the freed payment to investing). Read-only,
 * PAT-authenticated; shared contract for the CLI and MCP. When no lever is given,
 * `extraPerMonth` defaults to this cycle's planned spare.
 */
export const GET = withAuth(async (request, auth) => {
  const url = new URL(request.url);
  const num = (key: string): number | undefined => {
    const v = url.searchParams.get(key);
    return v != null && Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : undefined;
  };

  const base = await loadRepaymentFIBase({ supabase: auth.supabase, householdId: auth.householdId });
  const extraPerMonth = num("extraPerMonth") ?? base.suggestedExtra ?? 0;
  const lumpSum = num("lumpSum") ?? 0;

  return NextResponse.json(simulateRepaymentFI(base, { extraPerMonth, lumpSum }));
});
