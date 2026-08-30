// src/lib/accounts/balances.ts
// Data for the Balances widget on /budgets: one current balance per account,
// with per-account visibility so the list stays glanceable.
//
// Deliberately its own loader rather than a second consumer of computeNetWorth:
// net worth is a totals-and-snapshot contract shared by the API/CLI/MCP surfaces
// (its NetWorthAccount shape is published in the OpenAPI schema), whereas this is
// a display list keyed by akahu_account_id and carrying the visibility flag. The
// one domain rule they share — a balance's sign decides asset vs liability — is
// imported from the shared `isLiabilityBalance` in ./classify, not re-derived.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { cachedHouseholdRead } from "@/lib/cache/household";
import { isManualId } from "@/lib/assets/manual";
import { isLiabilityBalance, isRevolvingFacility } from "./classify";

export interface BalanceAccount {
  /** akahu_account_id — the key the visibility route writes against. */
  akahuAccountId: string;
  name: string;
  institution: string;
  type: string;
  balance: number;
  currency: string;
  /** Whether the account is shown in the widget (accounts.show_on_dashboard). */
  shown: boolean;
  isLiability: boolean;
  /** A revolving/offset credit facility (accounts.is_revolving_facility). Its
   *  balance is what's DRAWN, so an undrawn facility reads $0 — the headroom in
   *  `available` is the number that actually means something. */
  isRevolving: boolean;
  /** Undrawn headroom for a revolving facility; null for everything else. */
  available: number | null;
}

export interface BalancesResult {
  /** Every eligible account, shown and hidden — edit mode needs the full list. */
  accounts: BalanceAccount[];
  /** Sum of the SHOWN balances only, signed (so liabilities subtract). */
  shownTotal: number;
  shownCount: number;
  hiddenCount: number;
}

/** The raw columns the widget needs. */
export interface BalanceAccountRow {
  akahu_account_id: string;
  name: string;
  institution: string | null;
  type: string;
  balance_current: number | string | null;
  currency: string | null;
  show_on_dashboard: boolean | null;
  akahu_status: string | null;
  is_revolving_facility?: boolean | null;
  balance_available?: number | string | null;
}

/**
 * Shape account rows into the widget model: drop accounts that aren't live,
 * order them (assets by size desc, then liabilities by size desc — the way you'd
 * read a balance sheet), and total the visible ones.
 *
 * Eligibility: an Akahu account counts while its link is ACTIVE; a manual asset
 * row (`manual_*`, no Akahu status) always counts. This is what keeps retired
 * connections — e.g. the closed PocketSmith import account — out of the list
 * without the user having to hide them one by one.
 */
export function shapeBalances(rows: BalanceAccountRow[]): BalancesResult {
  const accounts: BalanceAccount[] = [];
  for (const r of rows) {
    const manual = isManualId(r.akahu_account_id);
    if (!manual && r.akahu_status !== "ACTIVE") continue;
    const balance = Number(r.balance_current ?? 0);
    const revolving = isRevolvingFacility(r);
    accounts.push({
      akahuAccountId: r.akahu_account_id,
      name: (r.name ?? "").trim(),
      institution: (r.institution ?? "").trim(),
      type: r.type,
      balance,
      currency: r.currency ?? "NZD",
      // Default-on: a household that has never edited the widget sees everything.
      shown: r.show_on_dashboard !== false,
      isLiability: isLiabilityBalance(balance),
      isRevolving: revolving,
      available: revolving && r.balance_available != null ? Number(r.balance_available) : null,
    });
  }

  accounts.sort((a, b) => {
    if (a.isLiability !== b.isLiability) return a.isLiability ? 1 : -1;
    return Math.abs(b.balance) - Math.abs(a.balance);
  });

  const shown = accounts.filter((a) => a.shown);
  const shownTotal = shown.reduce((sum, a) => sum + a.balance, 0);
  return {
    accounts,
    shownTotal: Math.round(shownTotal * 100) / 100,
    shownCount: shown.length,
    hiddenCount: accounts.length - shown.length,
  };
}

/** Load + shape every account balance for a household. */
export async function getBalances(args: {
  supabase: SupabaseClient;
  householdId: string;
}): Promise<BalancesResult> {
  const { data, error } = await scopedDb(args.supabase, args.householdId).accounts.select(
    "akahu_account_id, name, institution, type, balance_current, balance_available, currency, show_on_dashboard, akahu_status, is_revolving_facility",
  );
  if (error) throw new Error(error.message);
  return shapeBalances((data ?? []) as BalanceAccountRow[]);
}

/**
 * Cached `getBalances` for the /budgets widget. Plain JSON, so it round-trips
 * through the household read cache; any household write (including a visibility
 * toggle) busts the tag.
 */
export async function getCachedBalances(householdId: string): Promise<BalancesResult> {
  return cachedHouseholdRead(householdId, ["balances"], (supabase) =>
    getBalances({ supabase, householdId }),
  );
}
