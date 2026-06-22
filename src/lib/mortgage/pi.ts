import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { simulateTranche, monthsToYM } from "./simulate";
import { scenarioActive, scenarioPayoffForTranche, overallMonths, type ScenarioInput, type ScenarioPayoff } from "./scenario";
export type { ScenarioInput, ScenarioPayoff } from "./scenario";

// Mortgage P&I — a read-only FI lens, NOT part of budgeting.
//
// Live model (migration 0025): the gross repayment ("Mortgage Part N") counts as
// spend on the budget page, and the separate "Mortgage Interest" charge is silent
// (excluded from spend) because it's already inside the gross payment. This view
// re-derives the interest/principal split from the same transactions purely to
// answer FI questions ("real cost vs equity built", "mortgage-free when?"). It
// touches nothing in the spend pipeline.
//
// Sign convention (matches compute.ts / known-issues.md): debits are negative,
// credits positive; outflow = -amount. The gross repayment is a two-legged
// transfer, both legs categorised "Mortgage Part N":
//   * checking-side leg — a debit (amount < 0): the real cash out.
//   * loan-credit far leg — a credit (amount > 0): lands on the loan account.
// The interest charge is a debit (amount < 0) posted on the loan account.

const PART_NAME_RE = /^Mortgage Part \d+$/i;
const INTEREST_NAME = "Mortgage Interest";

// Run-rate window for the payoff estimate: trailing 90 days ≈ 3 months.
const TRAILING_DAYS = 90;
const TRAILING_MONTHS = 3;

export interface MortgageTxn {
  category_name: string;
  account_id: string;
  amount: number;
  occurred_at: string;
}
export interface MortgageAccount {
  id: string;
  name: string;
  balance_current: number | null;
  type?: string | null; // 'loan', 'checking', … — interest only counts on loans
}
export interface MortgagePartMeta {
  label: string;
  kind: "table" | "revolving";
  accountId: string | null;
  rate: number | null; // annual % p.a.
  fixedUntil: string | null; // ISO date
  repayment: number | null; // scheduled monthly repayment
  notes: string | null;
}
export interface SummariseInput {
  partTxns: MortgageTxn[]; // transactions in any "Mortgage Part N" category
  interestTxns: MortgageTxn[]; // transactions in "Mortgage Interest"
  accounts: MortgageAccount[];
  partsMeta?: MortgagePartMeta[]; // contractual terms from mortgage_parts
}

export interface PayoffEstimate {
  monthlyPayment: number;
  monthlyRatePct: number;
  annualRatePct: number;
  monthsRemaining: number | null; // null = payment ≤ interest (never) or no data
  freeDate: string | null; // "YYYY-MM", null when monthsRemaining is null
  totalInterest?: number; // remaining interest over the life of the loan
}
export interface RevolvingFacility {
  accountId: string;
  name: string;
  balance: number;
  interestYtd: number;
  notes: string | null;
}
export interface MortgagePart {
  name: string;
  loanAccountId: string | null;
  loanAccountName: string | null;
  balance: number; // magnitude of the loan balance, 0 if unknown
  grossYtd: number;
  interestYtd: number | null; // null when not separately attributable
  principalYtd: number | null; // gross − interest, null when interest is null
  ratePct: number | null; // annual rate used for the payoff
  rateSource: "contractual" | "estimated";
  fixedUntil: string | null;
  refixMonths: number | null; // whole months until fixed_until (null if floating/unknown)
  payoff: PayoffEstimate | null;
  scenarioPayoff: ScenarioPayoff | null;
}
export interface MortgagePI {
  year: number;
  totals: {
    grossYtd: number;
    interestYtd: number; // interest on the amortising tranches (matches principal)
    principalYtd: number; // gross − attributable interest
    otherInterestYtd: number; // interest not tied to an amortising tranche
    // (e.g. an interest-only / revolving facility) — real cost, but no principal
    balance: number;
  };
  parts: MortgagePart[];
  revolving: RevolvingFacility[]; // interest-only / non-reducing facilities (flagged, not amortised)
  payoff: { monthsRemaining: number | null; freeDate: string | null };
  scenario: { applied: boolean; monthsRemaining: number | null; freeDate: string | null; interestSaved: number | null };
  estimated: boolean; // true if any tranche's rate was derived, not contractual
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Standard amortisation payoff. r is the per-period (monthly) rate as a fraction.
// Returns whole months remaining, or null when the payment can't cover interest
// (balance never amortises) or inputs are unusable.
export function estimatePayoff(args: {
  balance: number;
  monthlyPayment: number;
  monthlyRate: number; // fraction, e.g. 0.005 = 0.5%/mo
}): PayoffEstimate {
  const balance = Math.max(0, args.balance);
  const P = Math.max(0, args.monthlyPayment);
  const r = Math.max(0, args.monthlyRate);
  const base: PayoffEstimate = {
    monthlyPayment: round2(P),
    monthlyRatePct: round2(r * 100),
    annualRatePct: round2(r * 12 * 100),
    monthsRemaining: null,
    freeDate: null,
  };
  if (balance <= 0) return { ...base, monthsRemaining: 0, freeDate: null };
  if (P <= 0) return base;
  if (r === 0) {
    return { ...base, monthsRemaining: Math.ceil(balance / P), freeDate: null };
  }
  // Payment must exceed the first month's interest, else it never pays off.
  if (P <= r * balance) return base;
  const months = Math.ceil(-Math.log(1 - (r * balance) / P) / Math.log(1 + r));
  return { ...base, monthsRemaining: months, freeDate: null };
}

// Whole months from `now` until an ISO date (floored at 0); null if no date.
function monthsUntil(now: Date, iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const months = (d.getUTCFullYear() - now.getUTCFullYear()) * 12 + (d.getUTCMonth() - now.getUTCMonth());
  return Math.max(0, months);
}

// ---------------------------------------------------------------------------
// Pure phase helpers for summariseMortgagePI. Each is deterministic given its
// inputs and individually unit-testable; summariseMortgagePI just wires them
// together. Splitting them out keeps the (formerly ~270-line) orchestrator
// shallow without changing any observable output.
// ---------------------------------------------------------------------------

// Per-tranche Part-leg aggregation (gross YTD + trailing run-rate + which loan
// account the credit legs land on).
export interface PartAccum {
  grossYtd: number;
  trailingGross: number;
  creditByAccount: Map<string, number>; // which loan account the credit legs hit
}

// Resolved account-side facts about every tranche, derived from its Part legs.
export interface PartLegGrouping {
  accum: Map<string, PartAccum>;
  loanAccount: Map<string, string | null>; // tranche → its loan account (most-hit credit leg)
  accountClaimCount: Map<string, number>; // loan account → how many tranches claim it
}

// Phase 1 — group Part legs by tranche name, then resolve each tranche's loan
// account (the account its credit legs hit most) and how many tranches claim
// each account (a shared account can't be split per tranche).
export function groupPartLegs(
  partTxns: MortgageTxn[],
  windows: { now: Date; yearStart: Date; trailingStart: Date },
): PartLegGrouping {
  const { now, yearStart, trailingStart } = windows;
  const accum = new Map<string, PartAccum>();
  const ensure = (name: string): PartAccum => {
    let p = accum.get(name);
    if (!p) {
      p = { grossYtd: 0, trailingGross: 0, creditByAccount: new Map() };
      accum.set(name, p);
    }
    return p;
  };
  for (const t of partTxns) {
    const occurred = new Date(t.occurred_at);
    const outflow = -Number(t.amount);
    const p = ensure(t.category_name);
    if (outflow > 0) {
      // checking-side debit = real cash out
      if (occurred >= yearStart && occurred < now) p.grossYtd += outflow;
      if (occurred >= trailingStart && occurred < now) p.trailingGross += outflow;
    } else if (outflow < 0) {
      // credit far leg lands on the loan account — record which one
      p.creditByAccount.set(t.account_id, (p.creditByAccount.get(t.account_id) ?? 0) + -outflow);
    }
  }

  // Resolve each tranche's loan account = the account its credit legs hit most.
  const loanAccount = new Map<string, string | null>();
  for (const [name, p] of accum) {
    let best: string | null = null;
    let bestAmt = 0;
    for (const [acct, amt] of p.creditByAccount) {
      if (amt > bestAmt) {
        bestAmt = amt;
        best = acct;
      }
    }
    loanAccount.set(name, best);
  }

  // A loan account is uniquely attributable to a tranche only if no other tranche
  // claims it (shared account → interest can't be split per tranche).
  const accountClaimCount = new Map<string, number>();
  for (const acct of loanAccount.values()) {
    if (acct) accountClaimCount.set(acct, (accountClaimCount.get(acct) ?? 0) + 1);
  }

  return { accum, loanAccount, accountClaimCount };
}

export interface InterestByAccount {
  ytdByAccount: Map<string, number>;
  trailingByAccount: Map<string, number>;
  totalAllYtd: number;
}

// Phase 2 — attribute Mortgage Interest charges to loan accounts (YTD + trailing
// run-rate). Interest is only cost-of-borrowing when it sits on a loan account:
// the bank debits a revolving facility's interest from whatever transactional
// account it's drawn from (e.g. an everyday checking account) tagged Mortgage
// Interest; counting that would invent a phantom facility, so scope to loans.
export function attributeInterest(
  interestTxns: MortgageTxn[],
  loanAccountIds: Set<string>,
  windows: { now: Date; yearStart: Date; trailingStart: Date },
): InterestByAccount {
  const { now, yearStart, trailingStart } = windows;
  const ytdByAccount = new Map<string, number>();
  const trailingByAccount = new Map<string, number>();
  for (const t of interestTxns) {
    const occurred = new Date(t.occurred_at);
    const charge = -Number(t.amount); // debit → positive charge
    if (charge <= 0) continue;
    if (!loanAccountIds.has(t.account_id)) continue; // ignore interest on non-loan accounts
    if (occurred >= yearStart && occurred < now) {
      ytdByAccount.set(t.account_id, (ytdByAccount.get(t.account_id) ?? 0) + charge);
    }
    if (occurred >= trailingStart && occurred < now) {
      trailingByAccount.set(t.account_id, (trailingByAccount.get(t.account_id) ?? 0) + charge);
    }
  }
  const totalAllYtd = [...ytdByAccount.values()].reduce((a, b) => a + b, 0);
  return { ytdByAccount, trailingByAccount, totalAllYtd };
}

// Phase 3 — match a tranche to its contractual terms (mortgage_parts). Match by
// exact loan account first, else by nearest scheduled repayment, so it never
// depends on how the bank account is named. `used` tracks already-matched meta
// rows so two tranches can't claim the same one (mutated across calls — one
// instance per summarise run).
export function matchContractualMeta(
  tableMeta: MortgagePartMeta[],
  used: Set<number>,
  loanAccountId: string | null,
  observedPayment: number,
): MortgagePartMeta | null {
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < tableMeta.length; i++) {
    if (used.has(i)) continue;
    const m = tableMeta[i];
    if (loanAccountId && m.accountId && m.accountId === loanAccountId) {
      bestIdx = i;
      break;
    }
    if (m.repayment != null) {
      const diff = Math.abs(m.repayment - observedPayment);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
  }
  // Tolerance for the repayment-proximity fallback: within $80 (covers the
  // 1208/1210/1236 spread without cross-matching unrelated loans).
  if (bestIdx >= 0 && (bestDiff <= 80 || bestDiff === Infinity)) {
    used.add(bestIdx);
    return tableMeta[bestIdx];
  }
  return null;
}

// Phase 4 — build one tranche row: derive its balance, interest/principal split,
// observed/contractual rate + repayment, and baseline + scenario payoffs.
export function buildTrancheRow(args: {
  name: string;
  accum: PartAccum;
  grouping: PartLegGrouping;
  interest: InterestByAccount;
  balanceByAccount: Map<string, number>;
  nameByAccount: Map<string, string>;
  tableMeta: MortgagePartMeta[];
  usedMeta: Set<number>;
  now: Date;
  monthsElapsed: number;
  scenActive: boolean;
  scenario?: ScenarioInput;
}): MortgagePart {
  const {
    name, accum: p, grouping, interest, balanceByAccount, nameByAccount,
    tableMeta, usedMeta, now, monthsElapsed, scenActive, scenario,
  } = args;
  const loanAccountId = grouping.loanAccount.get(name) ?? null;
  const attributable = loanAccountId != null && grouping.accountClaimCount.get(loanAccountId) === 1;

  const balance = loanAccountId ? balanceByAccount.get(loanAccountId) ?? 0 : 0;
  const interestYtd = attributable ? interest.ytdByAccount.get(loanAccountId!) ?? 0 : null;
  const principalYtd = interestYtd != null ? round2(p.grossYtd - interestYtd) : null;

  // Observed monthly payment from the trailing window, falling back to YTD pace.
  const observedPayment =
    p.trailingGross > 0 ? p.trailingGross / TRAILING_MONTHS : p.grossYtd / monthsElapsed;

  const meta = matchContractualMeta(tableMeta, usedMeta, loanAccountId, observedPayment);

  // Rate: contractual when known, else derived from the posted interest charge.
  const trailingInterest = attributable ? interest.trailingByAccount.get(loanAccountId!) ?? 0 : 0;
  const derivedAnnual = balance > 0 ? (trailingInterest / TRAILING_MONTHS / balance) * 12 * 100 : 0;
  const contractual = meta?.rate != null;
  const annualRate = contractual ? meta!.rate! : derivedAnnual;
  const rateSource: "contractual" | "estimated" = contractual ? "contractual" : "estimated";
  const monthlyPayment = meta?.repayment ?? observedPayment;
  const fixedUntil = meta?.fixedUntil ?? null;
  const refixMonths = monthsUntil(now, fixedUntil);

  let payoff: PayoffEstimate | null = null;
  let scenarioPayoff: ScenarioPayoff | null = null;
  if (balance > 0 && monthlyPayment > 0) {
    const base = simulateTranche({ balance, monthlyPayment, annualRate });
    payoff = {
      monthlyPayment: round2(monthlyPayment),
      monthlyRatePct: round2(annualRate / 12),
      annualRatePct: round2(annualRate),
      monthsRemaining: base.monthsRemaining,
      freeDate: base.monthsRemaining != null ? monthsToYM(now, base.monthsRemaining) : null,
      totalInterest: base.totalInterest,
    };

    if (scenActive) {
      scenarioPayoff = scenarioPayoffForTranche({ balance, monthlyPayment, annualRate, refixMonths }, now, scenario!);
    }
  }

  return {
    name,
    loanAccountId,
    loanAccountName: loanAccountId ? nameByAccount.get(loanAccountId) ?? null : null,
    balance: round2(balance),
    grossYtd: round2(p.grossYtd),
    interestYtd: interestYtd != null ? round2(interestYtd) : null,
    principalYtd,
    ratePct: balance > 0 ? round2(annualRate) : null,
    rateSource,
    fixedUntil,
    refixMonths,
    payoff,
    scenarioPayoff,
  };
}

// Phase 5 — interest-only / non-reducing facilities: any loan account carrying
// mortgage interest that no amortising tranche claims. These never self-amortise,
// so they're surfaced as a caveat (with their balance + YTD cost), not a payoff.
export function buildRevolvingFacilities(args: {
  interestYtdByAccount: Map<string, number>;
  loanAccount: Map<string, string | null>;
  revolvingMeta: MortgagePartMeta[];
  balanceByAccount: Map<string, number>;
  nameByAccount: Map<string, string>;
}): RevolvingFacility[] {
  const { interestYtdByAccount, loanAccount, revolvingMeta, balanceByAccount, nameByAccount } = args;
  const partAccountSet = new Set([...loanAccount.values()].filter((a): a is string => !!a));
  const revolving: RevolvingFacility[] = [];
  for (const [accountId, interest] of interestYtdByAccount) {
    if (partAccountSet.has(accountId)) continue;
    const m =
      revolvingMeta.find((x) => x.accountId === accountId) ??
      (revolvingMeta.length === 1 ? revolvingMeta[0] : null);
    revolving.push({
      accountId,
      name: nameByAccount.get(accountId) ?? "Revolving facility",
      balance: round2(balanceByAccount.get(accountId) ?? 0),
      interestYtd: round2(interest),
      notes: m?.notes ?? null,
    });
  }
  return revolving;
}

// Pure aggregation + payoff math. Deterministic given `now`. When `partsMeta`
// carries contractual terms (rate/fixed-until/repayment), payoff is computed from
// those; otherwise the rate is derived from the posted interest charge. An
// optional scenario (extra repayment / lump / refix rate) produces a what-if
// payoff alongside the baseline. The phases above do the work; this just wires
// them together and assembles the totals.
export function summariseMortgagePI(
  input: SummariseInput,
  opts: { now: Date; scenario?: ScenarioInput },
): MortgagePI {
  const { now } = opts;
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const trailingStart = new Date(now.getTime() - TRAILING_DAYS * 86400000);
  const windows = { now, yearStart, trailingStart };

  const balanceByAccount = new Map<string, number>();
  const nameByAccount = new Map<string, string>();
  // Interest is only cost-of-borrowing when it sits on a loan account (see
  // attributeInterest). Build the account lookups + loan-account set up front.
  const loanAccountIds = new Set<string>();
  for (const a of input.accounts) {
    balanceByAccount.set(a.id, Math.abs(Number(a.balance_current ?? 0)));
    nameByAccount.set(a.id, a.name);
    if (a.type === "loan") loanAccountIds.add(a.id);
  }

  // monthsElapsed this calendar year (≥1), for the early-year payment fallback.
  const monthsElapsed = Math.max(1, now.getUTCMonth() + 1);

  const grouping = groupPartLegs(input.partTxns, windows);
  const interest = attributeInterest(input.interestTxns, loanAccountIds, windows);

  const tableMeta = (input.partsMeta ?? []).filter((m) => m.kind === "table");
  const usedMeta = new Set<number>();
  const scenActive = scenarioActive(opts.scenario);

  // --- Build per-tranche rows. ---------------------------------------------
  const parts: MortgagePart[] = [];
  let attributedInterestYtd = 0; // interest tied to an amortising tranche (raw, pre-round)
  let anyEstimated = false;
  for (const name of [...grouping.accum.keys()].sort()) {
    const loanAccountId = grouping.loanAccount.get(name) ?? null;
    const attributable = loanAccountId != null && grouping.accountClaimCount.get(loanAccountId) === 1;
    // Accumulate the raw (un-rounded) attributed interest, matching the original
    // single-pass sum so totals.interestYtd/principalYtd round identically.
    if (attributable) attributedInterestYtd += interest.ytdByAccount.get(loanAccountId!) ?? 0;

    const row = buildTrancheRow({
      name,
      accum: grouping.accum.get(name)!,
      grouping,
      interest,
      balanceByAccount,
      nameByAccount,
      tableMeta,
      usedMeta,
      now,
      monthsElapsed,
      scenActive,
      scenario: opts.scenario,
    });
    if (row.rateSource === "estimated") anyEstimated = true;
    parts.push(row);
  }

  // --- Revolving / interest-only facilities (flagged, not amortised). ------
  const revolving = buildRevolvingFacilities({
    interestYtdByAccount: interest.ytdByAccount,
    loanAccount: grouping.loanAccount,
    revolvingMeta: (input.partsMeta ?? []).filter((m) => m.kind === "revolving"),
    balanceByAccount,
    nameByAccount,
  });

  const totalGrossYtd = parts.reduce((a, p) => a + p.grossYtd, 0);
  const totalBalance = parts.reduce((a, p) => a + p.balance, 0);

  // Overall mortgage-free = the latest amortising-tranche payoff (the mortgage is
  // gone when the last tranche clears). The revolving facility is excluded by
  // design — it's interest-only and surfaced separately. Uses the shared
  // overallMonths roll-up (also used by simulateScenario) so server + client
  // never diverge.
  const overall = (get: (p: MortgagePart) => number | null | undefined): number | null =>
    overallMonths(parts.map((p) => ({ balance: p.balance, months: get(p) ?? null })));
  const baseMonths = overall((p) => p.payoff?.monthsRemaining);
  const scenMonths = scenActive ? overall((p) => p.scenarioPayoff?.monthsRemaining) : null;
  const interestSaved = scenActive
    ? round2(parts.reduce((a, p) => a + (p.scenarioPayoff?.interestSaved ?? 0), 0))
    : null;

  return {
    year,
    totals: {
      grossYtd: round2(totalGrossYtd),
      // Interest split: tranche interest pairs with principal; any interest not
      // tied to a repaying tranche (e.g. an interest-only / revolving facility) is
      // real cost but reduces no principal, so it's reported separately and never
      // subtracted from gross to find principal.
      interestYtd: round2(attributedInterestYtd),
      principalYtd: round2(totalGrossYtd - attributedInterestYtd),
      otherInterestYtd: round2(interest.totalAllYtd - attributedInterestYtd),
      balance: round2(totalBalance),
    },
    parts,
    revolving,
    payoff: {
      monthsRemaining: baseMonths,
      freeDate: baseMonths != null && baseMonths > 0 ? monthsToYM(now, baseMonths) : null,
    },
    scenario: {
      applied: scenActive,
      monthsRemaining: scenMonths,
      freeDate: scenMonths != null && scenMonths > 0 ? monthsToYM(now, scenMonths) : null,
      interestSaved,
    },
    estimated: anyEstimated,
  };
}

// DB-fetching wrapper: resolve the mortgage categories, pull their transactions
// (calendar year, plus a trailing tail for the run-rate), load accounts, then run
// the pure core.
export async function computeMortgagePI(args: {
  supabase: SupabaseClient;
  householdId: string;
  now?: Date;
  scenario?: ScenarioInput;
}): Promise<MortgagePI> {
  const { supabase, householdId, scenario } = args;
  const db = scopedDb(supabase, householdId);
  const now = args.now ?? new Date();
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const trailingStart = new Date(now.getTime() - (TRAILING_DAYS + 30) * 86400000);
  const fetchFrom = trailingStart < yearStart ? trailingStart : yearStart;

  const [catsRes, metaRes] = await Promise.all([
    db.categories.select("id, name"),
    db.mortgage_parts
      .select("label, kind, account_id, rate, fixed_until, repayment, notes"),
  ]);
  if (catsRes.error) throw new Error(catsRes.error.message);
  // mortgage_parts is optional (table may not exist / be empty) — tolerate errors.
  const partsMeta: MortgagePartMeta[] = (metaRes.error ? [] : metaRes.data ?? []).map((m: any) => ({
    label: m.label as string,
    kind: (m.kind as string) === "revolving" ? "revolving" : "table",
    accountId: (m.account_id as string) ?? null,
    rate: m.rate == null ? null : Number(m.rate),
    fixedUntil: (m.fixed_until as string) ?? null,
    repayment: m.repayment == null ? null : Number(m.repayment),
    notes: (m.notes as string) ?? null,
  }));

  const partCatIds: string[] = [];
  const interestCatIds: string[] = [];
  const nameById = new Map<string, string>();
  for (const c of catsRes.data ?? []) {
    nameById.set(c.id as string, c.name as string);
    if (PART_NAME_RE.test(c.name as string)) partCatIds.push(c.id as string);
    else if ((c.name as string) === INTEREST_NAME) interestCatIds.push(c.id as string);
  }

  const allCatIds = [...partCatIds, ...interestCatIds];
  if (allCatIds.length === 0) {
    return summariseMortgagePI({ partTxns: [], interestTxns: [], accounts: [], partsMeta }, { now, scenario });
  }

  // Transactions span from the mortgage's origin (potentially years back) to now,
  // which can exceed PostgREST's default 1000-row page cap. selectAllPaged pages
  // explicitly so a long history never silently truncates and quietly skews the
  // YTD/run-rate/payoff math.
  const [txnRows, acctsRes] = await Promise.all([
    db.transactions.selectAllPaged<any>((q) =>
      q.select("category_id, account_id, amount, occurred_at")
        .in("category_id", allCatIds)
        .gte("occurred_at", fetchFrom.toISOString())
        .lt("occurred_at", now.toISOString())
        .order("occurred_at", { ascending: true }),
    ),
    db.accounts.select("id, name, balance_current, type"),
  ]);
  if (acctsRes.error) throw new Error(acctsRes.error.message);

  const partSet = new Set(partCatIds);
  const partTxns: MortgageTxn[] = [];
  const interestTxns: MortgageTxn[] = [];
  for (const t of txnRows) {
    const row: MortgageTxn = {
      category_name: nameById.get(t.category_id as string) ?? "",
      account_id: t.account_id as string,
      amount: Number(t.amount),
      occurred_at: t.occurred_at as string,
    };
    if (partSet.has(t.category_id as string)) partTxns.push(row);
    else interestTxns.push(row);
  }

  const accounts: MortgageAccount[] = (acctsRes.data ?? []).map((a: any) => ({
    id: a.id as string,
    name: a.name as string,
    balance_current: a.balance_current == null ? null : Number(a.balance_current),
    type: (a.type as string) ?? null,
  }));

  return summariseMortgagePI({ partTxns, interestTxns, accounts, partsMeta }, { now, scenario });
}
