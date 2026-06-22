import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { scopedDb } from "@/lib/supabase/scoped";
import { getFirstNested } from "@/lib/supabase/relations";

export const dynamic = "force-dynamic";

/**
 * GET /api/review — transactions awaiting categorisation review.
 *
 * Shared contract for `finops review` (fast terminal review). PAT-authenticated.
 * Returns uncategorised transactions (category_id null, not manually locked),
 * most recent first. Query param `limit` (default 50, max 200).
 */
export const GET = withAuth(async (request, auth) => {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);

  const { data, error, count } = await scopedDb(auth.supabase, auth.householdId).transactions
    .select("id, occurred_at, amount, merchant, description, accounts(name, type)", {
      count: "exact",
    })
    .is("category_id", null)
    .eq("is_manual_category", false)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const transactions = (data ?? []).map((t: any) => {
    const acct = getFirstNested(t.accounts);
    return {
      id: t.id,
      occurred_at: t.occurred_at,
      amount: Number(t.amount),
      merchant: t.merchant ?? null,
      description: t.description ?? null,
      account: acct?.name ?? null,
    };
  });

  return NextResponse.json({ pending: count ?? transactions.length, transactions });
});
