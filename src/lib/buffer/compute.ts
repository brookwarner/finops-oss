// src/lib/buffer/compute.ts
//
// Emergency fund (cash buffer): a sized, tracked stock of liquid cash held for
// income shocks / surprises — distinct from sinking-fund reserves (earmarked for
// known costs), the savings contribution goal (a flow), and FI investments
// (long-term, market-exposed).
//
// Sizing is AUTO: target = N months × your essential monthly spend (from
// categories.spend_class = 'essential'), so it self-adjusts as costs change.
// The balance is a DESIGNATED liquid account (accounts.is_emergency_fund), which
// is carved out of FI assets — the same dollars aren't both safety net and FI
// progress.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { normaliseSpendClass } from "@/lib/spend/classify";

export interface EmergencyFundState {
  /** Whether an account is designated as the emergency fund. */
  configured: boolean;
  accountName: string | null;
  balance: number;          // designated account balance (≥ 0)
  essentialMonthly: number; // trailing essential spend, per month
  targetMonths: number;     // N (months of essentials)
  target: number;           // targetMonths × essentialMonthly
  shortfall: number;        // max(0, target − balance) — what's still to fund
  monthsCovered: number | null; // balance ÷ essentialMonthly
  pctFunded: number | null; // balance ÷ target
  funded: boolean;          // balance ≥ target (target > 0)
}

const DEFAULT_TARGET_MONTHS = 3;

/** Pure: derive the fund state from its inputs. */
export function emergencyFundState(args: {
  configured: boolean;
  accountName: string | null;
  balance: number;
  essentialMonthly: number;
  targetMonths: number;
}): EmergencyFundState {
  const balance = Math.max(0, args.balance);
  const essentialMonthly = Math.max(0, args.essentialMonthly);
  const targetMonths = Math.max(0, args.targetMonths);
  const target = essentialMonthly * targetMonths;
  return {
    configured: args.configured,
    accountName: args.accountName,
    balance,
    essentialMonthly,
    targetMonths,
    target,
    shortfall: Math.max(0, target - balance),
    monthsCovered: essentialMonthly > 0 ? balance / essentialMonthly : null,
    pctFunded: target > 0 ? balance / target : null,
    funded: target > 0 && balance >= target,
  };
}

/** Pure: trailing essential spend scaled to a month. Caller passes only essential
 *  outflows; refunds (inflows) net off. */
export function essentialMonthlySpend(txns: { amount: number }[], windowDays: number): number {
  if (windowDays <= 0) return 0;
  let spend = 0;
  for (const t of txns) spend += -Number(t.amount); // outflow positive
  return (Math.max(0, spend) * 365) / (windowDays * 12);
}

const DAY_MS = 86_400_000;
const ESSENTIAL_WINDOW_DAYS = 365;
const SPENDABLE_KINDS = new Set(["monthly_cap", "ap_amortised"]);

/**
 * Load the emergency-fund state from live data. Essential monthly spend comes
 * from the trailing year of `spend_class = 'essential'` spend (NULL ⇒ essential,
 * conservative); the balance/target from the designated `is_emergency_fund`
 * account. Returns `configured: false` (with the would-be target) when none is
 * designated, so callers can prompt setup without erroring.
 */
export async function computeEmergencyFund(args: {
  supabase: SupabaseClient;
  householdId: string;
  now?: Date;
}): Promise<EmergencyFundState> {
  const { supabase, householdId } = args;
  const now = args.now ?? new Date();
  const since = new Date(now.getTime() - ESSENTIAL_WINDOW_DAYS * DAY_MS).toISOString();
  const db = scopedDb(supabase, householdId);

  const [acctRes, spendRes] = await Promise.all([
    db.accounts
      .select("name, balance_current, emergency_fund_target_months")
      .eq("is_emergency_fund", true)
      .maybeSingle(),
    db.transactions
      .select("amount, categories(kind, spend_class)")
      .gte("occurred_at", since)
      .not("category_id", "is", null),
  ]);
  if (acctRes.error) throw new Error(acctRes.error.message);
  if (spendRes.error) throw new Error(spendRes.error.message);

  const essentialTxns = ((spendRes.data ?? []) as any[]).filter((t) => {
    const c = Array.isArray(t.categories) ? t.categories[0] : t.categories;
    return c && SPENDABLE_KINDS.has(c.kind) && normaliseSpendClass(c.spend_class) === "essential";
  });
  const essentialMonthly = essentialMonthlySpend(essentialTxns, ESSENTIAL_WINDOW_DAYS);

  const acct = acctRes.data as { name: string; balance_current: number | null; emergency_fund_target_months: number | null } | null;
  return emergencyFundState({
    configured: !!acct,
    accountName: acct?.name ?? null,
    balance: Number(acct?.balance_current ?? 0),
    essentialMonthly,
    targetMonths: acct ? Number(acct.emergency_fund_target_months ?? DEFAULT_TARGET_MONTHS) : DEFAULT_TARGET_MONTHS,
  });
}
