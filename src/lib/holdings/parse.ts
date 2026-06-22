/** A single security in an Akahu investment/KiwiSaver account's meta.portfolio[]. */
export interface PortfolioEntry {
  fund_id: string;
  name: string;
  symbol?: string | null;
  logo?: string | null;
  currency: string;
  shares?: number | null;
  value: number;
  returns: number;
}

/** A row ready to upsert into the `holdings` table. Money fields are native currency. */
export interface HoldingRow {
  household_id: string;
  account_id: string;
  fund_id: string;
  symbol: string | null;
  name: string;
  logo: string | null;
  currency: string;
  shares: number | null;
  value: number;
  returns: number;
  cost_basis: number;
}

export interface PortfolioSource {
  meta?: { portfolio?: PortfolioEntry[] | null } | null;
}

/**
 * Map an Akahu account's meta.portfolio into holding rows for one account.
 * Returns [] when the account has no portfolio. cost_basis = value - returns
 * (native currency). Values are NOT FX-normalised — see the M5 data-layer spec.
 */
export function parsePortfolio(
  account: PortfolioSource,
  ctx: { accountId: string; householdId: string },
): HoldingRow[] {
  const portfolio = account.meta?.portfolio;
  if (!portfolio || portfolio.length === 0) return [];
  return portfolio.map((e) => ({
    household_id: ctx.householdId,
    account_id: ctx.accountId,
    fund_id: e.fund_id,
    symbol: e.symbol ?? null,
    name: e.name,
    logo: e.logo ?? null,
    currency: e.currency,
    shares: e.shares ?? null,
    value: e.value,
    returns: e.returns,
    cost_basis: Number((e.value - e.returns).toFixed(4)),
  }));
}
