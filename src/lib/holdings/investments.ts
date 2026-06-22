import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import {
  groupHoldings,
  type AccountHoldings,
  type AccountRecord,
  type HoldingRecord,
} from "./group";

/**
 * Load every investment/KiwiSaver holding for a household, grouped under its
 * account with cumulative + annualised (CAGR) returns. The single data path
 * behind the `/investments` PWA page, `GET /api/investments` (CLI), and the
 * `get_holdings` MCP tool, so all four surfaces report identical numbers.
 */
export async function loadInvestments(args: {
  supabase: SupabaseClient;
  householdId: string;
  asOf?: Date;
}): Promise<AccountHoldings[]> {
  const db = scopedDb(args.supabase, args.householdId);
  const [holdingsRes, acctsRes] = await Promise.all([
    db.holdings.select(
      "account_id, fund_id, symbol, name, logo, currency, shares, value, returns, cost_basis, first_seen, first_seen_observed",
    ),
    db.accounts.select("id, name, type, balance_current, investment_inception_date"),
  ]);
  if (holdingsRes.error) throw new Error(holdingsRes.error.message);
  if (acctsRes.error) throw new Error(acctsRes.error.message);
  return groupHoldings(
    (holdingsRes.data ?? []) as HoldingRecord[],
    (acctsRes.data ?? []) as AccountRecord[],
    { asOf: args.asOf },
  );
}

/** Set (or clear, with null) an account's manual "investing since" date. Used by
 *  `PATCH /api/investments/inception`. Returns the updated account name. */
export async function setInvestmentInception(args: {
  supabase: SupabaseClient;
  householdId: string;
  accountId: string;
  date: string | null;
}): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  const db = scopedDb(args.supabase, args.householdId);
  const { data, error } = await db.accounts
    .update({ investment_inception_date: args.date })
    .eq("id", args.accountId)
    .select("name")
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: "account not found" };
  return { ok: true, name: data.name };
}
