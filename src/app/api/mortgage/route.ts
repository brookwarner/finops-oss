import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { computeMortgagePI } from "@/lib/mortgage/pi";
import { getCachedMortgagePI } from "@/lib/mortgage/cached";

export const dynamic = "force-dynamic";

/**
 * GET /api/mortgage — mortgage P&I lens (read-only, not a budget surface).
 *
 * Interest vs principal repaid (calendar YTD), per tranche where attributable,
 * plus an *estimated* mortgage-free date derived from the trailing-90d payment
 * and the rate implied by the posted interest charge. Shared contract for the
 * `finops` CLI and the `get_mortgage_pi` MCP tool. PAT-authenticated.
 *
 * Query params:
 *   `year`        optional — defaults to the current calendar year.
 *   `extraMonthly`, `lumpSum`, `refixRate` — optional what-if scenario levers;
 *                 when any is set, the response's `scenario` block is populated.
 */
export const GET = withAuth(async (request, auth) => {
  const sp = new URL(request.url).searchParams;
  const yearParam = sp.get("year");
  let now: Date | undefined;
  if (yearParam) {
    const y = Number(yearParam);
    // Anchor "now" to year-end so a past year reports its full 12 months; clamp a
    // future/current year to the actual present so we never project from the future.
    if (Number.isInteger(y) && y >= 2000 && y <= 2100) {
      const yearEnd = new Date(Date.UTC(y, 11, 31, 23, 59, 59));
      now = yearEnd < new Date() ? yearEnd : undefined;
    }
  }

  const num = (key: string): number | undefined => {
    const v = sp.get(key);
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const scenario = {
    extraPerMonth: num("extraMonthly"),
    lumpSum: num("lumpSum"),
    refixRate: num("refixRate"),
  };

  // The default lens (current year, no what-if levers) is cached; a specific year
  // or any scenario lever is parameterised and rare → compute live.
  const hasScenario =
    scenario.extraPerMonth !== undefined ||
    scenario.lumpSum !== undefined ||
    scenario.refixRate !== undefined;
  const result =
    now === undefined && !hasScenario
      ? await getCachedMortgagePI(auth.householdId)
      : await computeMortgagePI({
          supabase: auth.supabase,
          householdId: auth.householdId,
          now,
          scenario,
        });
  return NextResponse.json(result);
});
