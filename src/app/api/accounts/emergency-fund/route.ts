import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scopedDb } from "@/lib/supabase/scoped";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/emergency-fund — designate one account as the household's
 * emergency fund and/or set its target in months of essentials.
 * Body: { akahuAccountId, value?: boolean, targetMonths?: number }.
 *  - value === true  → make this the emergency fund (clears any existing one first,
 *    since at most one is allowed per household).
 *  - value === false → un-designate this account.
 *  - value omitted    → just update targetMonths on this account.
 */
export async function POST(request: NextRequest) {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const akahuAccountId = String(body.akahuAccountId ?? "");
  if (!akahuAccountId) return NextResponse.json({ error: "akahuAccountId required" }, { status: 400 });
  const hasValue = typeof body.value === "boolean";
  const value = body.value === true;
  const targetMonths =
    body.targetMonths != null && Number.isFinite(Number(body.targetMonths))
      ? Math.min(24, Math.max(1, Number(body.targetMonths)))
      : undefined;

  const db = scopedDb(supabase, householdId);

  // Designating a new fund: clear any existing one first (one per household).
  if (hasValue && value) {
    const clear = await db.accounts.update({ is_emergency_fund: false }).eq("is_emergency_fund", true);
    if (clear.error) return NextResponse.json({ error: clear.error.message }, { status: 400 });
  }

  const update: { is_emergency_fund?: boolean; emergency_fund_target_months?: number } = {};
  if (hasValue) update.is_emergency_fund = value;
  if (targetMonths !== undefined) update.emergency_fund_target_months = targetMonths;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await db.accounts
    .update(update)
    .eq("akahu_account_id", akahuAccountId)
    .select("akahu_account_id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "account not found in this household" }, { status: 404 });
  return NextResponse.json({ ok: true, akahuAccountId, value: hasValue ? value : undefined, targetMonths });
}
