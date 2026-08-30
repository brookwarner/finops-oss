import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scopedDb } from "@/lib/supabase/scoped";
import { revalidateHousehold } from "@/lib/cache/household";

export const dynamic = "force-dynamic";

/** POST /api/accounts/visibility — set accounts.show_on_dashboard for one account
 *  in the caller's household. Body: { akahuAccountId, value }. Drives which rows
 *  the Balances widget on /budgets lists; display-only, no engine reads it. */
export async function POST(request: NextRequest) {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const akahuAccountId = String(body.akahuAccountId ?? "");
  const value = body.value === true;
  if (!akahuAccountId) return NextResponse.json({ error: "akahuAccountId required" }, { status: 400 });

  const db = scopedDb(supabase, householdId);
  const { data, error } = await db.accounts
    .update({ show_on_dashboard: value })
    .eq("akahu_account_id", akahuAccountId)
    .select("akahu_account_id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "account not found in this household" }, { status: 404 });

  // The widget reads through getCachedBalances (60s TTL) — bust the household
  // tag so the next render reflects the toggle immediately.
  revalidateHousehold(householdId);
  return NextResponse.json({ ok: true, akahuAccountId, value });
}
