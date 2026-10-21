import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { getFirstNested } from "@/lib/supabase/relations";
import { isLiabilityBalance } from "@/lib/accounts/classify";

export interface NetWorthAccount { name: string; type: string; balance: number; isLiability: boolean; currency: string; }
export interface CurrencyTotals { currency: string; assets: number; liabilities: number; net: number; }
export interface NetWorthResult extends CurrencyTotals { accounts: NetWorthAccount[]; foreignCurrencies: CurrencyTotals[]; }

// Akahu stores balances signed: assets positive, liabilities (loans, mortgages,
// credit cards, overdrawn accounts) negative. We classify the assets/liabilities
// split by SIGN rather than account type — robust to mislabelled accounts (e.g. a
// loan recorded with a "checking" type still has a negative balance and counts as
// a liability). `liabilities` is reported as a negative total so money owed reads
// as a negative; net worth is the plain signed sum (assets + liabilities), NOT a
// subtraction — that would double-negate and inflate net worth.
// Includes manual assets stored in `accounts` (e.g. the home, keyed by a synthetic
// akahu_account_id), so `net` now spans bank/loan balances and manual valuations.
export async function computeNetWorth(args: { supabase: SupabaseClient; householdId: string }): Promise<NetWorthResult> {
  const { data, error } = await scopedDb(args.supabase, args.householdId)
    .accounts.select("name, type, currency, balance_current, expected_inflows(likelihood)");
  if (error) throw new Error(error.message);
  const totals = new Map<string, CurrencyTotals>();
  const accounts: NetWorthAccount[] = [];
  for (const a of (data ?? []) as any[]) {
    const likelihood = getFirstNested<{ likelihood?: string }>(a.expected_inflows)?.likelihood;
    if (a.type === "receivable" && likelihood === "uncertain") continue; // uncertain money you're owed doesn't pad net worth
    const balance = Number(a.balance_current ?? 0);
    const isLiability = isLiabilityBalance(balance);
    const currency = a.currency;
    const group = totals.get(currency) ?? { currency, assets: 0, liabilities: 0, net: 0 };
    if (isLiability) group.liabilities += balance; else group.assets += balance;
    group.net = group.assets + group.liabilities;
    totals.set(currency, group);
    accounts.push({ name: a.name, type: a.type, balance, isLiability, currency });
  }
  const nzd = totals.get("NZD") ?? { currency: "NZD", assets: 0, liabilities: 0, net: 0 };
  return { ...nzd, accounts, foreignCurrencies: [...totals.values()]
    .filter(t => t.currency !== "NZD").sort((a, b) => a.currency.localeCompare(b.currency)) };
}
