// src/lib/cashflow/inflows.ts
// Pure model for "expected one-off inflows" (tax refund, bonus, late invoice,
// bond refund, receivership claim). Replaces the receivership-specific tranche
// model. No Supabase — safe to import from client components.

const DAY_MS = 86_400_000;

export type Likelihood = "likely" | "uncertain";

export interface Inflow {
  id: string;              // the receivable's akahu_account_id (manual_*)
  label: string;           // the account name
  amount: number;          // balance_current, clamped >= 0
  likelihood: Likelihood;
  expectedDate: string | null; // ISO yyyy-mm-dd; null → offset by likelihood
  taxRate: number;         // 0 unless the terms mark it pre-tax
}

/** Default days until an inflow lands when it has no explicit expected date. */
export function likelihoodOffsetDays(likelihood: Likelihood): number {
  return likelihood === "uncertain" ? 84 : 28;
}

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

/** The land date to use when an inflow is toggled on without an explicit date. */
export function defaultLandDate(inflow: Inflow, now: Date): string {
  if (inflow.expectedDate) return inflow.expectedDate;
  return iso(new Date(now.getTime() + likelihoodOffsetDays(inflow.likelihood) * DAY_MS));
}

interface InflowTerms {
  likelihood?: string | null;
  expected_date?: string | null;
  pre_tax?: boolean | null;
  tax_rate?: number | null;
}

interface InflowRow {
  akahu_account_id: string;
  name: string;
  type: string;
  balance_current: number | null;
  // PostgREST embeds a to-one relation (expected_inflows is unique on
  // akahu_account_id) as a single OBJECT — but a one-element array under some
  // FK introspections. Accept both; normalise via firstTerms().
  expected_inflows?: InflowTerms | InflowTerms[] | null;
}

/** Normalise PostgREST's to-one embed (object | one-element array | null). */
function firstTerms(value: InflowTerms | InflowTerms[] | null | undefined): InflowTerms | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

/** Map receivable account rows (with an embedded expected_inflows row) to Inflows.
 *  Non-receivable rows are skipped. Missing terms default to likely/no-date/0. */
export function mapInflows(rows: InflowRow[]): Inflow[] {
  const out: Inflow[] = [];
  for (const r of rows) {
    if (r.type !== "receivable") continue;
    const terms = firstTerms(r.expected_inflows);
    const likelihood: Likelihood = terms?.likelihood === "uncertain" ? "uncertain" : "likely";
    const preTax = terms?.pre_tax === true;
    const taxRate = preTax ? Math.min(1, Math.max(0, Number(terms?.tax_rate ?? 0))) : 0;
    out.push({
      id: r.akahu_account_id,
      label: r.name,
      amount: Math.max(0, Number(r.balance_current ?? 0)),
      likelihood,
      expectedDate: terms?.expected_date ?? null,
      taxRate,
    });
  }
  return out;
}

/** Net (after-tax) amount a single inflow contributes when it lands. */
export function inflowNet(inflow: Inflow): number {
  return Math.round(inflow.amount * (1 - inflow.taxRate) * 100) / 100;
}

/**
 * Net (after-tax) sum of expected inflows due to land by `cycleEnd` — the
 * forward-looking income to fold into the cycle's position projection when there
 * is no stable salary plan to anchor on (irregular contractor income). Each
 * inflow's land date is its explicit `expected_date`, else a likelihood-based
 * offset from `now` (`defaultLandDate`). An inflow whose date has already passed
 * but is still outstanding (its receivable balance hasn't been zeroed by a real
 * payment) still counts — it's money owed and expected, not yet arrived.
 *
 * Only `likely` inflows count by default; `uncertain` ones are excluded from the
 * "on track" number for the same reason net worth excludes them — they aren't
 * bankable yet. No overlap with settled/pending income: these are receivables
 * that haven't posted (once paid, the balance drops to 0 and they fall out here).
 */
export function expectedInflowByCycleEnd(
  inflows: Inflow[],
  cycleEnd: Date,
  now: Date,
  opts?: { includeUncertain?: boolean },
): number {
  const includeUncertain = opts?.includeUncertain ?? false;
  let total = 0;
  for (const inflow of inflows) {
    if (inflow.amount <= 0) continue;
    if (!includeUncertain && inflow.likelihood === "uncertain") continue;
    const land = new Date(`${defaultLandDate(inflow, now)}T00:00:00Z`);
    if (land > cycleEnd) continue;
    total += inflowNet(inflow);
  }
  return Math.round(total * 100) / 100;
}
