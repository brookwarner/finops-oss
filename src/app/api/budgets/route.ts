import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest, parseRequest, withAuth } from "@/lib/api/auth";
import { getCachedBudgets } from "@/lib/budgets/cached";
import { defaultPeriod, parseDate } from "@/lib/budgets/period";
import { filterByGroup, findCategory } from "@/lib/budgets/select";
import { createBudget } from "@/lib/budgets/write";
import { createBudgetSchema } from "@/lib/api/schemas";
import { revalidateHousehold } from "@/lib/cache/household";

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

/**
 * POST /api/budgets — create a net-new budget.
 *
 * Attaches to an existing category (exact case-insensitive name match) if one
 * exists and has no budget yet, else creates the category too. Refuses if the
 * category already has a budget — use PATCH /api/budgets/target instead.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = await parseRequest(request, { body: createBudgetSchema });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data.body;

  const result = await createBudget({
    supabase: auth.supabase, householdId: auth.householdId,
    categoryName: body.category, kind: body.kind, monthlyTarget: body.monthlyTarget, group: body.group,
  });
  if (!result.ok) {
    if (result.reason === "already-has-budget") {
      return NextResponse.json(
        { error: "already-has-budget", existingTarget: result.existingTarget },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  revalidateHousehold(auth.householdId);
  return NextResponse.json({
    category: body.category, categoryCreated: result.categoryCreated,
    kind: result.kind, monthlyTarget: result.monthlyTarget, group: result.group,
  });
}
