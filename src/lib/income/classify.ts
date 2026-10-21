// src/lib/income/classify.ts
//
// Income classification (migration 0042). Each income category carries an
// `income_type` describing the *nature* of the source, which drives the logic
// that used to silently assume everything was a salary:
//   - the forecast only projects salary/recurring income forward as future pay
//     (a one-off receivership lump must never become a phantom monthly "pay"),
//   - the runway treats the *absence* of recent salary income as "not salaried"
//     and nets only dependable non-salary income against the burn-down.

export type IncomeType = "salary" | "recurring" | "irregular" | "one_off";

export const INCOME_TYPES: IncomeType[] = ["salary", "recurring", "irregular", "one_off"];

/** Income whose cadence the forecast may project forward as future pay. A one-off
 *  or irregular receipt is real, but assuming it repeats would invent income. */
export const FORWARD_INCOME_TYPES = new Set<IncomeType>(["salary", "recurring"]);

/** Non-salary income dependable enough to net against the runway burn-down.
 *  Salary is excluded by design — when the runway is the hero, the salary has
 *  stopped; irregular/one-off income is too unpredictable to count on. */
export const RUNWAY_ONGOING_INCOME_TYPES = new Set<IncomeType>(["recurring"]);

/** NULL / unknown ⇒ 'recurring' — back-compat: today every income stream is
 *  eligible to be projected forward, so an unclassified source keeps that. */
export function normaliseIncomeType(raw: string | null | undefined): IncomeType {
  return raw === "salary" || raw === "recurring" || raw === "irregular" || raw === "one_off"
    ? raw
    : "recurring";
}

/** Whether income of this type should be projected forward as repeating pay. */
export function projectsForward(raw: string | null | undefined): boolean {
  return FORWARD_INCOME_TYPES.has(normaliseIncomeType(raw));
}

/** Whether this income type is netted against the runway burn-down. */
export function isOngoingRunwayIncome(raw: string | null | undefined): boolean {
  return RUNWAY_ONGOING_INCOME_TYPES.has(normaliseIncomeType(raw));
}

export const INCOME_TYPE_LABEL: Record<IncomeType, string> = {
  salary: "Salary",
  recurring: "Recurring",
  irregular: "Irregular",
  one_off: "One-off",
};

export const INCOME_TYPE_HELP: Record<IncomeType, string> = {
  salary: "Regular employment wage. Projected forward as pay; while it's landing, the app treats you as salaried.",
  recurring: "Other dependable income (partner income, interest, rent). Projected forward and netted against your runway.",
  irregular: "Sporadic, unpredictable income. Never assumed to repeat.",
  one_off: "Lands once and never repeats (a payout, lump sum, or gift). Never assumed to repeat.",
};
