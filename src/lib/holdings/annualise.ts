// Annualised (CAGR) return from a cumulative since-purchase return + an
// inception date. Pure and surface-agnostic — the PWA, API, CLI and MCP all
// read the same numbers through groupHoldings.
//
// Why CAGR over the stored cost basis (not a money-weighted XIRR): Akahu hands
// us only the current `value` and cumulative `returns` per fund — never the
// individual contribution dates an XIRR needs. So we annualise the simple
// return `value/cost` over the holding period. For a drip-fed account this is
// mildly CONSERVATIVE (it credits later contributions with the full period),
// which is the honest direction to err. See holdings/parse.ts for cost basis.

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

// Annualising a holding tracked for only a few weeks turns noise into a wild
// rate (a 2% wobble over 3 weeks → ~40%/yr), so we suppress the figure until a
// holding has a meaningful run.
export const MIN_ANNUALISE_YEARS = 0.5;

/** Whole years between an ISO `yyyy-mm-dd` inception and `asOf` (default now). */
export function yearsSince(inception: string, asOf: Date = new Date()): number {
  // Parse the date parts explicitly — `new Date("2021-05-01")` is UTC midnight,
  // which can land on the previous day under NZ time and skew a short period.
  const [y, m, d] = inception.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  const start = new Date(y, m - 1, d).getTime();
  return (asOf.getTime() - start) / MS_PER_YEAR;
}

export interface AnnualiseInput {
  costBasis: number;
  returns: number;
  /** Effective inception (`yyyy-mm-dd`), or null when unknown. */
  inception: string | null;
  asOf?: Date;
  /** Override the short-holding suppression floor (mainly for tests). */
  minYears?: number;
}

/**
 * The compound annual growth rate as a percentage, or null when it can't be
 * computed honestly: no inception, non-positive cost basis or end value, or a
 * holding period below the suppression floor.
 *
 *   annualisedReturnPct({ costBasis: 1000, returns: 200, inception: <2y ago> })
 *     -> ~9.5  (1200/1000 compounded over 2 years)
 */
export function annualisedReturnPct(input: AnnualiseInput): number | null {
  const { costBasis, returns, inception } = input;
  if (!inception) return null;
  if (!(costBasis > 0)) return null;
  const endValue = costBasis + returns;
  if (!(endValue > 0)) return null; // a total wipeout has no finite growth rate

  const years = yearsSince(inception, input.asOf);
  const floor = input.minYears ?? MIN_ANNUALISE_YEARS;
  if (!(years >= floor)) return null;

  const cagr = Math.pow(endValue / costBasis, 1 / years) - 1;
  return cagr * 100;
}
