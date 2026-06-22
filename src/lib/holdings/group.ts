import { annualisedReturnPct, yearsSince } from "./annualise";

/** A holdings row as stored in `holdings` (native-currency money fields). */
export interface HoldingRecord {
  account_id: string;
  fund_id: string;
  symbol: string | null;
  name: string;
  logo: string | null;
  currency: string;
  shares: number | null;
  value: number | null;
  returns: number | null;
  cost_basis: number | null;
  /** Date first observed by the sync (`yyyy-mm-dd`); see migration 0037. */
  first_seen?: string | null;
  /** False for rows backfilled by 0037 (first_seen is not a real purchase date). */
  first_seen_observed?: boolean | null;
}

/** The account context a holding belongs to. */
export interface AccountRecord {
  id: string;
  name: string;
  type: string;
  balance_current: number | null;
  /** Manual "investing since" date (`yyyy-mm-dd`); see migration 0037. */
  investment_inception_date?: string | null;
}

/** A single fund prepared for display. */
export interface HoldingView {
  fundId: string;
  symbol: string | null;
  name: string;
  logo: string | null;
  currency: string;
  shares: number | null;
  value: number;
  returns: number;
  costBasis: number;
  returnPct: number | null;
  /** Effective inception used for annualisation (`yyyy-mm-dd`), or null. */
  inception: string | null;
  /** Compound annual growth rate %, or null when too short / unknown. */
  annualisedPct: number | null;
}

/** One investment account with its funds rolled up. */
export interface AccountHoldings {
  accountId: string;
  accountName: string;
  accountType: string;
  /** Authoritative per-account value in NZD (accounts.balance_current). */
  balanceNZD: number | null;
  /** The shared currency of all funds in this account, or null if mixed. */
  currency: string | null;
  totalValue: number;
  totalReturn: number;
  totalCost: number;
  /** Cumulative return %: totalReturn/totalCost for a single-currency account,
   *  else a value-weighted blend of the per-fund %s (the native dollar totals
   *  can't be summed across currencies — suppress those, not this). */
  returnPct: number | null;
  /** Effective account inception (`yyyy-mm-dd`), or null. */
  inception: string | null;
  /** Where `inception` came from: a manual seed vs the earliest observed sync. */
  inceptionSource: "manual" | "observed" | null;
  /** Years the account has been tracked/held, or null. */
  heldYears: number | null;
  /** Account-level CAGR %, or null when too short / unknown. */
  annualisedPct: number | null;
  holdings: HoldingView[];
}

function toNum(n: number | null | undefined): number {
  return Number(n ?? 0);
}

// A row counts as a genuine observation (its first_seen is the real purchase
// date) unless 0037 explicitly flagged it as a backfill. Records without the
// flag at all (e.g. tests) are treated as observed.
function isObserved(h: HoldingRecord): boolean {
  return h.first_seen_observed !== false && !!h.first_seen;
}

/**
 * Group raw `holdings` rows under their owning accounts, sorted by value, with
 * per-account roll-ups and annualised (CAGR) returns.
 *
 * Native-currency caveat (see the M5 data-layer migration): per-fund `value`/
 * `returns`/`cost_basis` are in the fund's own currency. Summing them is only
 * meaningful when an account's funds share one currency, so `currency` is null
 * for a mixed-currency account and callers should suppress its native totals
 * (the NZD `balanceNZD` from the account stays authoritative regardless).
 *
 * Annualisation (see ./annualise): each account gets an effective inception —
 * its manual `investment_inception_date` when set, else the earliest genuinely
 * observed `first_seen`. An account with any backfilled (un-observed) fund and
 * no manual seed gets no annualised figure, so historic holdings never show a
 * rate computed from an unreliable backfill date — the caller prompts for a
 * date instead. Per fund, observed funds annualise off their own first_seen;
 * backfilled funds use the manual seed (or nothing).
 */
export function groupHoldings(
  holdings: HoldingRecord[],
  accounts: AccountRecord[],
  opts: { asOf?: Date } = {},
): AccountHoldings[] {
  const asOf = opts.asOf ?? new Date();
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const byAccount = new Map<string, HoldingRecord[]>();
  for (const h of holdings) {
    if (!byAccount.has(h.account_id)) byAccount.set(h.account_id, []);
    byAccount.get(h.account_id)!.push(h);
  }

  const groups: AccountHoldings[] = [];
  for (const [accountId, rows] of byAccount) {
    const acct = acctById.get(accountId);

    // Earliest genuinely-observed purchase anchors an all-observed account's
    // inception. A manual seed always wins; with any backfilled fund and no
    // seed we have no trustworthy anchor, so the account stays un-annualised.
    const observedDates = rows
      .filter(isObserved)
      .map((h) => h.first_seen as string)
      .sort();
    const earliestObserved = observedDates[0] ?? null;
    const hasBackfilled = rows.some((h) => h.first_seen_observed === false);
    const manual = acct?.investment_inception_date ?? null;
    const accountInception = manual ?? (hasBackfilled ? null : earliestObserved);
    const inceptionSource: "manual" | "observed" | null = manual
      ? "manual"
      : accountInception
        ? "observed"
        : null;

    // Observed funds carry their real purchase date; backfilled ones can only
    // borrow the manual seed (else they stay un-annualised).
    const fundInception = (h: HoldingRecord): string | null =>
      isObserved(h) ? (h.first_seen as string) : manual;

    const views: HoldingView[] = rows
      .map((h) => {
        const value = toNum(h.value);
        const returns = toNum(h.returns);
        const costBasis = toNum(h.cost_basis);
        const inception = fundInception(h);
        return {
          fundId: h.fund_id,
          symbol: h.symbol,
          name: h.name,
          logo: h.logo,
          currency: h.currency,
          shares: h.shares,
          value,
          returns,
          costBasis,
          returnPct: costBasis > 0 ? (returns / costBasis) * 100 : null,
          inception,
          annualisedPct: annualisedReturnPct({ costBasis, returns, inception, asOf }),
        };
      })
      .sort((a, b) => b.value - a.value);

    const currencies = new Set(views.map((v) => v.currency));
    const currency = currencies.size === 1 ? [...currencies][0] : null;
    const totalValue = views.reduce((s, v) => s + v.value, 0);
    const totalReturn = views.reduce((s, v) => s + v.returns, 0);
    const totalCost = views.reduce((s, v) => s + v.costBasis, 0);

    // Cumulative + annualised return, kept currency-safe.
    //  • Single currency: native totals are directly comparable, so the ratio
    //    totalReturn/totalCost is exact (unchanged behaviour).
    //  • Mixed currency: summing native costs/returns across currencies is
    //    meaningless, so instead blend the per-fund (unitless) return %s by
    //    value — the same currency-safe technique summarisePortfolio uses across
    //    accounts. Weighting by native value is a mild approximation (FX-true
    //    weights would be in NZD), but each per-fund rate is exact, so the blend
    //    is an honest headline where a native sum would be dimensionally muddled.
    //    The CAGR then derives from that blended fraction over the account's
    //    inception, identical in form to the single-currency path.
    let returnPct: number | null;
    let annualisedPct: number | null;
    if (currency !== null) {
      returnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : null;
      annualisedPct = annualisedReturnPct({
        costBasis: totalCost,
        returns: totalReturn,
        inception: accountInception,
        asOf,
      });
    } else {
      let weighted = 0;
      let weight = 0;
      for (const v of views) {
        if (v.returnPct == null || !(v.value > 0)) continue;
        weighted += v.value * v.returnPct;
        weight += v.value;
      }
      returnPct = weight > 0 ? weighted / weight : null;
      annualisedPct =
        returnPct == null
          ? null
          : annualisedReturnPct({
              costBasis: 1,
              returns: returnPct / 100,
              inception: accountInception,
              asOf,
            });
    }

    groups.push({
      accountId,
      accountName: acct?.name ?? "Unknown account",
      accountType: acct?.type ?? "investment",
      balanceNZD: acct ? acct.balance_current : null,
      currency,
      totalValue,
      totalReturn,
      totalCost,
      returnPct,
      inception: accountInception,
      inceptionSource,
      heldYears: accountInception ? yearsSince(accountInception, asOf) : null,
      annualisedPct,
      holdings: views,
    });
  }

  // Largest accounts first — by authoritative NZD value when present, else by
  // native total as a fallback.
  return groups.sort(
    (a, b) => (b.balanceNZD ?? b.totalValue) - (a.balanceNZD ?? a.totalValue),
  );
}

/** Whole-portfolio roll-up across every investment/KiwiSaver account. */
export interface PortfolioSummary {
  /** Total NZD value across all accounts that hold funds. */
  valueNZD: number;
  /** NZD-value-weighted blend of per-account cumulative return %, or null. */
  returnPct: number | null;
  /** NZD-value-weighted blend of per-account annualised (CAGR) %, or null when
   *  no account has a usable inception date. */
  annualisedPct: number | null;
  /** NZD value of the accounts the annualised blend covers (≤ valueNZD); less
   *  than valueNZD when some accounts still need an investing-since date. */
  annualisedCoverageNZD: number;
}

/**
 * Blend the per-account figures into one portfolio headline. Returns are blended
 * by each account's NZD value rather than summed, because per-fund cost bases are
 * in native currency and can't be added across accounts — a value-weighted blend
 * of the (unitless) percentage rates is the currency-safe equivalent. The
 * annualised blend only counts accounts with a usable inception, and reports the
 * NZD value it covers so callers can flag the uncovered remainder.
 */
export function summarisePortfolio(groups: AccountHoldings[]): PortfolioSummary {
  let valueNZD = 0;
  let retNum = 0;
  let retDen = 0;
  let annNum = 0;
  let annDen = 0;
  for (const g of groups) {
    const weight = g.balanceNZD ?? g.totalValue;
    if (!(weight > 0)) continue;
    valueNZD += weight;
    if (g.returnPct != null) {
      retNum += g.returnPct * weight;
      retDen += weight;
    }
    if (g.annualisedPct != null) {
      annNum += g.annualisedPct * weight;
      annDen += weight;
    }
  }
  return {
    valueNZD,
    returnPct: retDen > 0 ? retNum / retDen : null,
    annualisedPct: annDen > 0 ? annNum / annDen : null,
    annualisedCoverageNZD: annDen,
  };
}
