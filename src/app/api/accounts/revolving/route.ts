import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scopedDb } from "@/lib/supabase/scoped";

export const dynamic = "force-dynamic";

/** POST /api/accounts/revolving — set accounts.is_revolving_facility for one
 *  account in the caller's household. Body: { akahuAccountId, value }. */
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
    .update({ is_revolving_facility: value })
    .eq("akahu_account_id", akahuAccountId)
    .select("akahu_account_id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "account not found in this household" }, { status: 404 });
  return NextResponse.json({ ok: true, akahuAccountId, value });
}
