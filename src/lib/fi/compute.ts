// src/lib/fi/compute.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { loadInvestments } from "@/lib/holdings/investments";
import { summarisePortfolio } from "@/lib/holdings/group";
import {
  CAP_MONTHS,
  FI_ASSET_TYPES,
  RECURRING_SPEND_KINDS,
  SWR,
  REAL_RETURN,
  DOB,
  FI_TARGET_AGE,
  CONTRIBUTION_WINDOW_MONTHS,
  FI_CONTRIBUTION_CATEGORIES,
} from "./constants";

/** FI target net worth = annual recurring spend ÷ safe withdrawal rate. */
export function fiNumber(annualRecurringSpend: number, swr: number): number {
  if (annualRecurringSpend <= 0 || swr <= 0) return 0;
  return annualRecurringSpend / swr;
}

export interface FIProjection {
  reached: boolean;
  months: number | null;   // months to FI; null if beyond the cap
  fiDate: string | null;   // "YYYY-MM"
  fiAge: number | null;
}

/** Add whole calendar months to a UTC date, clamping day to the target month's length. */
function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // last day of target month
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}
function yearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** Whole years from dob to d (birthday-aware). */
function ageAt(d: Date, dob: Date): number {
  const age = d.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    d.getUTCMonth() < dob.getUTCMonth() ||
    (d.getUTCMonth() === dob.getUTCMonth() && d.getUTCDate() < dob.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

export interface ProjectVaryingArgs {
  startAssets: number;
  /** Contribution credited at the END of month `m` (1-based). Lets the
   *  contribution step up part-way through — e.g. when a mortgage clears and its
   *  freed repayment redirects to investing. */
  contributionAt: (month: number) => number;
  realAnnualReturn: number;
  fiNumber: number;
  now: Date;
  dob: Date;
  capMonths?: number;
}

/**
 * Compound assets monthly at the real rate plus a (possibly month-varying)
 * contribution until they reach the FI number. Today's dollars throughout.
 * Returns not-reached if the cap is hit (e.g. the gap never closes).
 * The single projection core — `projectFI` is the constant-contribution case.
 */
export function projectVarying(args: ProjectVaryingArgs): FIProjection {
  const cap = args.capMonths ?? CAP_MONTHS;
  if (args.fiNumber <= 0 || args.startAssets >= args.fiNumber) {
    return { reached: true, months: 0, fiDate: yearMonth(args.now), fiAge: ageAt(args.now, args.dob) };
  }
  const rMonthly = Math.pow(1 + args.realAnnualReturn, 1 / 12) - 1;
  let assets = args.startAssets;
  for (let m = 1; m <= cap; m++) {
    assets = assets * (1 + rMonthly) + args.contributionAt(m);
    if (assets >= args.fiNumber) {
      const d = addMonths(args.now, m);
      return { reached: true, months: m, fiDate: yearMonth(d), fiAge: ageAt(d, args.dob) };
    }
  }
  return { reached: false, months: null, fiDate: null, fiAge: null };
}

export interface ProjectFIArgs {
  startAssets: number;
  monthlyContribution: number;
  realAnnualReturn: number;
  fiNumber: number;
  now: Date;
  dob: Date;
  capMonths?: number;
}

/**
 * Compound assets monthly at the real rate plus a flat contribution until they
 * reach the FI number. Today's dollars throughout. Returns not-reached if the
 * cap is hit (e.g. contribution ≤ 0 and the gap never closes).
 */
export function projectFI(args: ProjectFIArgs): FIProjection {
  return projectVarying({
    startAssets: args.startAssets,
    contributionAt: () => args.monthlyContribution,
    realAnnualReturn: args.realAnnualReturn,
    fiNumber: args.fiNumber,
    now: args.now,
    dob: args.dob,
    capMonths: args.capMonths,
  });
}

/** Sum balances of savings + investment accounts (the liquid FI pool).
 *  Accounts flagged `is_reserve_buffer` OR `is_emergency_fund` are carved out —
 *  their balance is already counted as reserve cover / safety cushion and must
 *  not be double-counted as FI progress. */
export function fiAssetsFromAccounts(
  accounts: { type: string; balance_current: number | null; is_reserve_buffer?: boolean; is_emergency_fund?: boolean }[],
): number {
  return accounts
    .filter((a) => FI_ASSET_TYPES.has(a.type) && !a.is_reserve_buffer && !a.is_emergency_fund)
    .reduce((s, a) => s + Number(a.balance_current ?? 0), 0);
}

/**
 * Annualised recurring spend. Sums net outflow (−amount) over recurring-kind
 * transactions across a trailing window of `windowDays`, then scales to a year.
 * Refunds (inflows in a spend category) net off. Mortgage principal (transfer)
 * and sinking-fund reserves are excluded by kind.
 */
export function recurringAnnualSpend(
  txns: { amount: number; kind: string }[],
  windowDays: number,
): number {
  if (windowDays <= 0) return 0;
  let spend = 0;
  for (const t of txns) {
    if (!RECURRING_SPEND_KINDS.has(t.kind)) continue;
    spend += -Number(t.amount); // outflow positive
  }
  return Math.max(0, spend) * (365 / windowDays);
}

export interface ContributionResult {
  perMonth: number;
  byAccount: { name: string; net: number }[];
}

/**
 * Observed savings contribution: net transaction flow (deposits − withdrawals)
 * into FI-asset accounts over the window, expressed per month. This is the
 * creep-proof figure — only money that actually moved into savings/investment
 * counts. Per-account breakdown is returned so under-counting is visible.
 *
 * Note: interest/dividends credited to these accounts post as inflows too, so
 * they're counted here AND modelled again via the projection's real return — a
 * small double-count for high-interest savers. Accepted: it keeps the figure a
 * literal "what landed in savings", and the effect is minor at these balances.
 */
export function monthlyContribution(
  flows: { accountName: string; amount: number }[],
  windowMonths: number,
): ContributionResult {
  const byName = new Map<string, number>();
  for (const f of flows) {
    byName.set(f.accountName, (byName.get(f.accountName) ?? 0) + Number(f.amount));
  }
  const byAccount = [...byName.entries()].map(([name, net]) => ({ name, net }));
  const total = byAccount.reduce((s, a) => s + a.net, 0);
  return { perMonth: windowMonths > 0 ? total / windowMonths : 0, byAccount };
}

const DAY_MS = 86_400_000;
const SPEND_WINDOW_DAYS = 365;

export interface FIResult {
  fiNumber: number;
  fiAssets: number;
  pctToFI: number;
  gap: number;
  annualRecurringSpend: number;
  monthlyContribution: number;
  projection: FIProjection;
  targetAge: number;
  targetYear: number;
  vsTargetYears: number | null; // fiAge − targetAge (+ late), null if not reached
  assumptions: {
    swr: number;
    realReturn: number;
    /** Cumulative ("since purchase") return of the FI investment portfolio, as a
     *  fraction (0.15 = +15%). Value-weighted blend across investment accounts
     *  (KiwiSaver excluded — locked until 65). Backward-looking reality check,
     *  NOT fed into the projection. */
    actualReturnPct: number;
    /** The same portfolio's annualised (CAGR) return as a fraction, or null when
     *  no investment account has a usable inception date. Companion to
     *  actualReturnPct — the per-year rate the cumulative figure works out to. */
    actualReturnAnnualisedPct: number | null;
    contributionWindowMonths: number;
    fiAssetAccounts: { name: string; balance: number }[];
    contributionByAccount: { name: string; net: number }[];
    kiwiSaverBalance: number;
    spendBasis: string;
  };
}

export interface ComputeFIArgs {
  supabase: SupabaseClient;
  householdId: string;
  now?: Date;
  realReturn?: number;
}

export async function computeFI(args: ComputeFIArgs): Promise<FIResult> {
  const { supabase, householdId } = args;
  const now = args.now ?? new Date();
  const realReturn = args.realReturn ?? REAL_RETURN;
  const spendSince = new Date(now.getTime() - SPEND_WINDOW_DAYS * DAY_MS).toISOString();
  // ~30 days/month is a deliberate approximation; the divisor in monthlyContribution
  // uses the same integer month count, so the two stay consistent.
  const contribSince = new Date(now.getTime() - CONTRIBUTION_WINDOW_MONTHS * 30 * DAY_MS).toISOString();

  // scopedDb auto-injects `.eq("household_id", …)` on every query — the
  // defense-in-depth invariant the scoped-db guard test enforces.
  const db = scopedDb(supabase, householdId);
  // `investGroups` reuses the shared holdings path (grouped + annualised) so the
  // FI portfolio reality-check uses the exact same numbers as the /investments
  // headline — just scoped to investment accounts below.
  const [accountsRes, spendRes, flowRes, investGroups] = await Promise.all([
    db.accounts
      .select("name, type, balance_current, is_reserve_buffer, is_emergency_fund"),
    db.transactions
      .select("amount, categories(kind)")
      .gte("occurred_at", spendSince)
      .not("category_id", "is", null),
    db.transactions
      .select("amount, accounts(name, type, is_reserve_buffer, is_emergency_fund), categories(name)")
      .gte("occurred_at", contribSince),
    loadInvestments({ supabase, householdId, asOf: now }),
  ]);
  if (accountsRes.error) throw new Error(accountsRes.error.message);
  if (spendRes.error) throw new Error(spendRes.error.message);
  if (flowRes.error) throw new Error(flowRes.error.message);

  const accounts = (accountsRes.data ?? []) as any[];
  const fiAssets = fiAssetsFromAccounts(accounts);
  const fiAssetAccounts = accounts
    .filter((a) => FI_ASSET_TYPES.has(a.type) && !a.is_reserve_buffer && !a.is_emergency_fund)
    .map((a) => ({ name: a.name as string, balance: Number(a.balance_current ?? 0) }));
  const kiwiSaverBalance = accounts
    .filter((a) => a.type === "kiwisaver")
    .reduce((s, a) => s + Number(a.balance_current ?? 0), 0);

  const spendTxns = ((spendRes.data ?? []) as any[]).map((t) => {
    const c = Array.isArray(t.categories) ? t.categories[0] : t.categories;
    return { amount: Number(t.amount), kind: (c?.kind as string) ?? "" };
  });
  const annualRecurringSpend = recurringAnnualSpend(spendTxns, SPEND_WINDOW_DAYS);

  const rawFlows = ((flowRes.data ?? []) as any[]).map((t) => {
    const a = Array.isArray(t.accounts) ? t.accounts[0] : t.accounts;
    const c = Array.isArray(t.categories) ? t.categories[0] : t.categories;
    return {
      accountName: (a?.name as string) ?? "",
      accountType: (a?.type as string) ?? "",
      accountIsBuffer: ((a?.is_reserve_buffer as boolean) ?? false) || ((a?.is_emergency_fund as boolean) ?? false),
      categoryName: (c?.name as string) ?? "",
      amount: Number(t.amount),
    };
  });

  // Source 1: net flow INTO FI-asset accounts that have a feed.
  // Buffer accounts are excluded — their inflows are reserve replenishment, not FI saving.
  const assetInflows = rawFlows
    .filter((f) => FI_ASSET_TYPES.has(f.accountType) && !f.accountIsBuffer)
    .map((f) => ({ accountName: f.accountName, amount: f.amount }));

  // Source 2: OUTFLOWS routed via a contribution category, from NON-FI accounts
  // only (so they can never overlap with source 1). Outflow is negative; a
  // deposit of -40 is +40 of saving. Inflows here (refunds) net off.
  const categoryOutflows = rawFlows
    .filter(
      (f) =>
        FI_CONTRIBUTION_CATEGORIES.has(f.categoryName) &&
        !FI_ASSET_TYPES.has(f.accountType),
    )
    .map((f) => ({ accountName: `${f.accountName} → ${f.categoryName}`, amount: -f.amount }));

  const contribution = monthlyContribution(
    [...assetInflows, ...categoryOutflows],
    CONTRIBUTION_WINDOW_MONTHS,
  );

  // Portfolio reality-check: cumulative + annualised return over investment
  // holdings only (KiwiSaver excluded — locked until 65). summarisePortfolio
  // returns whole-percent figures; we store fractions to match the rest of
  // `assumptions`. Backward-looking context, never fed into the projection.
  const portfolio = summarisePortfolio(
    investGroups.filter((g) => g.accountType === "investment"),
  );
  const actualReturnPct = portfolio.returnPct != null ? portfolio.returnPct / 100 : 0;
  const actualReturnAnnualisedPct =
    portfolio.annualisedPct != null ? portfolio.annualisedPct / 100 : null;

  const target = fiNumber(annualRecurringSpend, SWR);
  const projection = projectFI({
    startAssets: fiAssets,
    monthlyContribution: contribution.perMonth,
    realAnnualReturn: realReturn,
    fiNumber: target,
    now,
    dob: DOB,
  });

  const targetYear = DOB.getUTCFullYear() + FI_TARGET_AGE;
  return {
    fiNumber: target,
    fiAssets,
    pctToFI: target > 0 ? fiAssets / target : 0,
    gap: target - fiAssets,
    annualRecurringSpend,
    monthlyContribution: contribution.perMonth,
    projection,
    targetAge: FI_TARGET_AGE,
    targetYear,
    vsTargetYears: projection.fiAge != null ? projection.fiAge - FI_TARGET_AGE : null,
    assumptions: {
      swr: SWR,
      realReturn,
      actualReturnPct,
      actualReturnAnnualisedPct,
      contributionWindowMonths: CONTRIBUTION_WINDOW_MONTHS,
      fiAssetAccounts,
      contributionByAccount: contribution.byAccount,
      kiwiSaverBalance,
      spendBasis: "Trailing 12mo recurring spend (monthly caps + auto-pay incl. mortgage interest; excludes mortgage principal, sinking funds, one-off-ish reserves).",
    },
  };
}
