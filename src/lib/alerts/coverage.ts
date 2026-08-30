import type { ShadowBill } from "@/lib/budgets/committed";
import type { AlertRow } from "./run";
import { money } from "./format";

export interface CoverageInput {
  householdId: string;
  periodStart: string;
  /** Recurring unbudgeted committed bills detected for this household. */
  shadowBills: ShadowBill[];
  /** Category ids already alerted (budget_coverage_gap) this cycle — for dedup. */
  alreadyAlertedCatIds: Set<string>;
}

/** One hygiene alert per recurring auto-payment that moves the headline but has
 *  no budget row. Mirrors the set self-heal acts on (decided upstream). */
export function decideCoverageAlerts(input: CoverageInput): AlertRow[] {
  const { householdId, periodStart, shadowBills, alreadyAlertedCatIds } = input;
  const rows: AlertRow[] = [];
  for (const b of shadowBills) {
    if (alreadyAlertedCatIds.has(b.categoryId)) continue;
    const body = `${b.name} is averaging ${money(b.monthlyAvg)}/mo with no budget — add a budget so it shows on the budgets page.`;
    rows.push({
      household_id: householdId,
      type: "budget_coverage_gap",
      category_id: b.categoryId,
      period_start: periodStart,
      state: null,
      txn_id: null,
      title: `${b.name} has no budget`,
      body,
      payload: { monthlyAvg: b.monthlyAvg, occurrences: b.occurrences },
      delivered: false,
      delivery_error: null,
    });
  }
  return rows;
}
