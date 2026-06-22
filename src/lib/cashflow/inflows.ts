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
