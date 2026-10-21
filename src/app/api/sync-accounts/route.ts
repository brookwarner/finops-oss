import { NextResponse, type NextRequest } from "next/server";
import { buildAkahuClientFromEnv } from "@/lib/akahu/client";
import { getAkahuUserToken } from "@/lib/akahu/config";
import { requireHouseholdId } from "@/lib/auth/household";
import { revalidateHousehold } from "@/lib/cache/household";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scopedDb } from "@/lib/supabase/scoped";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const householdId = await requireHouseholdId();
  const userToken = await getAkahuUserToken();

  const akahu = buildAkahuClientFromEnv();
  const accounts = await akahu.accounts.list(userToken);
  const supabase = await createSupabaseServerClient();
  const db = scopedDb(supabase, householdId);

  // Which accounts already exist? For those we update everything EXCEPT
  // `type` — Akahu's type mapping is a starting guess and the user may have
  // manually corrected it (e.g. a revolving-credit facility retyped to
  // 'checking' so its spend sign displays correctly). Don't clobber that.
  const { data: existing } = await db.accounts
    .select("akahu_account_id");
  const existingIds = new Set((existing ?? []).map((a: any) => a.akahu_account_id));

  for (const acct of accounts) {
    const common = {
      household_id: householdId,
      akahu_account_id: acct._id,
      name: acct.name,
      institution: acct.connection.name,
      akahu_status: acct.status,
      attributes: acct.attributes,
      currency: acct.balance?.currency ?? "NZD",
      balance_current: acct.balance?.current ?? null,
      balance_available: acct.balance?.available ?? null,
      refreshed_balance_at: acct.refreshed?.balance ?? null,
      refreshed_meta_at: acct.refreshed?.meta ?? null,
      refreshed_transactions_at: acct.refreshed?.transactions ?? null,
      refreshed_party_at: acct.refreshed?.party ?? null,
    };
    // Existing accounts: UPDATE only, leaving `type` untouched to preserve any
    // manual override. We can't express this as an upsert — Supabase upsert runs
    // as INSERT ... ON CONFLICT, so omitting `type` makes Postgres build an
    // insert tuple with type=NULL and trip the NOT NULL constraint *before* the
    // conflict resolves to an update. New accounts: INSERT with a mapped type.
    const { error } = existingIds.has(acct._id)
      ? await db.accounts
          .update(common)
          .eq("akahu_account_id", acct._id)
      : await db.accounts
          .insert({ ...common, type: mapAkahuType(acct.type) });
    if (error) {
      return NextResponse.json(
        { error: "Failed to upsert account", account: acct._id, details: error.message },
        { status: 500 },
      );
    }
  }

  revalidateHousehold(householdId);
  return NextResponse.redirect(new URL("/connect", request.url), { status: 303 });
}

function mapAkahuType(t: string): string {
  const m: Record<string, string> = {
    CHECKING: "checking",
    SAVINGS: "savings",
    CREDITCARD: "credit_card",
    LOAN: "loan",
    KIWISAVER: "kiwisaver",
    INVESTMENT: "investment",
    TERMDEPOSIT: "term_deposit",
    FOREIGN: "foreign",
    TAX: "tax",
    REWARDS: "rewards",
    WALLET: "wallet",
  };
  return m[t] ?? "other";
}
