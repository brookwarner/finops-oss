import { NextResponse, type NextRequest } from "next/server";
import { resolveIdentity } from "@/lib/api/identity";
import { resolveCategory } from "@/lib/categories/resolve";
import { categoriseTransactions } from "@/lib/transactions/write";
import { revalidateHousehold } from "@/lib/cache/household";
import { UUID_RE } from "@/lib/uuid";

export async function PATCH(request: NextRequest) {
  const auth = await resolveIdentity(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    transactionIds?: string[];
    categoryId?: string | null;
    category?: string;
  };
  if (!Array.isArray(body.transactionIds) || body.transactionIds.length === 0) {
    return NextResponse.json({ error: "transactionIds required" }, { status: 400 });
  }

  let categoryId: string | null;
  let categoryName: string | undefined;
  if (body.category !== undefined) {
    const res = await resolveCategory(auth.supabase, auth.householdId, body.category);
    if (!res.ok) {
      return NextResponse.json(
        { error: res.reason, candidates: res.candidates.map((c) => c.name) },
        { status: 400 },
      );
    }
    categoryId = res.category.id;
    categoryName = res.category.name;
  } else {
    categoryId = body.categoryId ?? null;
    if (categoryId !== null && !UUID_RE.test(categoryId)) {
      return NextResponse.json({ error: "invalid categoryId" }, { status: 400 });
    }
  }

  try {
    const result = await categoriseTransactions({
      supabase: auth.supabase,
      householdId: auth.householdId,
      transactionIds: body.transactionIds,
      categoryId,
    });
    revalidateHousehold(auth.householdId);
    // Echo the resolved category name (name-based callers — CLI/MCP) so they can
    // build a copy-pasteable apply-similar nudge. PWA passes categoryId; it ignores this.
    return NextResponse.json(categoryName ? { category: categoryName, ...result } : result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
