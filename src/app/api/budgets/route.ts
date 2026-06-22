import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { getCachedBudgets } from "@/lib/budgets/cached";
import { defaultPeriod, parseDate } from "@/lib/budgets/period";
import { filterByGroup, findCategory } from "@/lib/budgets/select";

export const dynamic = "force-dynamic";

/**
 * GET /api/budgets — budget status for the current (or given) period.
 *
 * Shared contract for the `finops` CLI. PAT-authenticated. Query params:
 *   from, to   ISO dates overriding the default 20th→20th cycle.
 *   group      case-insensitive group filter.
 *   category   case-insensitive single-category lookup (exact, then substring).
 *
 * With `category`, returns `{ found, budget, period }`; otherwise the full
 * `{ period, flex, inbox, position, budgets }` set.
 */
export const GET = withAuth(async (request, auth) => {
  const { searchParams } = new URL(request.url);
  const d = defaultPeriod(new Date());
  const period = {
    start: parseDate(searchParams.get("from") ?? undefined, d.start),
    end: parseDate(searchParams.get("to") ?? undefined, d.end),
  };

  const result = await getCachedBudgets(auth.householdId, period);

  const category = searchParams.get("category");
  if (category) {
    const row = findCategory(result.rows, category);
    return NextResponse.json({
      found: Boolean(row),
      category,
      period: result.period,
      budget: row ?? null,
    });
  }

  const rows = filterByGroup(result.rows, searchParams.get("group"));

  return NextResponse.json({
    period: result.period,
    flex: result.flex,
    inbox: result.inbox,
    position: result.position,
    budgets: rows,
  });
});
