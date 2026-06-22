import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest, parseRequest } from "@/lib/api/auth";
import { resolveCategory } from "@/lib/categories/resolve";
import { setBudgetTarget } from "@/lib/budgets/write";
import { revalidateHousehold } from "@/lib/cache/household";
import { setBudgetTargetSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = await parseRequest(request, { body: setBudgetTargetSchema });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data.body;

  const res = await resolveCategory(auth.supabase, auth.householdId, body.category);
  if (!res.ok) {
    return NextResponse.json({ error: res.reason, candidates: res.candidates.map((c) => c.name) }, { status: 400 });
  }

  const result = await setBudgetTarget({
    supabase: auth.supabase, householdId: auth.householdId,
    categoryId: res.category.id, monthlyTarget: body.monthlyTarget,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: `no budget for ${res.category.name}; create it in the PWA first` },
      { status: 404 },
    );
  }
  revalidateHousehold(auth.householdId);
  return NextResponse.json({ category: res.category.name, ...result });
}
