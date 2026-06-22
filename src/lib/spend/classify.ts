// src/lib/spend/classify.ts
// Per-category spend classification (migration 0043): essential (unavoidable) vs
// discretionary (pausable). Drives the cashflow game-plan's bare-essentials floor
// and discretionary cut lever. NULL ⇒ essential (an unclassified cost is assumed
// unavoidable, so a scenario can never wish it away — conservative for survival).

export type SpendClass = "essential" | "discretionary";
export const SPEND_CLASSES: SpendClass[] = ["essential", "discretionary"];

export function normaliseSpendClass(raw: string | null | undefined): SpendClass {
  return raw === "discretionary" ? "discretionary" : "essential";
}

export function isEssential(raw: string | null | undefined): boolean {
  return normaliseSpendClass(raw) === "essential";
}

const DISCRETIONARY_NAMES = new Set([
  "Restaurants/Dining/Snacks", "Haircuts", "Pets/Pet Care", "Allowances",
  "Sports & Recreation", "Donations", "Caravan Repayments",
]);
const ESSENTIAL_NAMES = new Set([
  "Groceries", "Power", "Water", "Rates", "Service Charges/Fees", "Telephone Services",
  "Mortgage Interest", "Mortgage Part 1", "Mortgage Part 2", "Mortgage Part 3",
  "Gasoline/Fuel", "Parking", "Public Transport", "Education", "Insurance",
  "Debt Repayments", "Healthcare/Medical", "Taxes",
]);
const DISCRETIONARY_GROUPS = new Set(["Discretionary", "Maintenance"]);

/** Seed/default classification: name match wins, then group, else essential. */
export function defaultSpendClass(group: string | null, name: string | null): SpendClass {
  if (name && DISCRETIONARY_NAMES.has(name)) return "discretionary";
  if (name && ESSENTIAL_NAMES.has(name)) return "essential";
  if (group && DISCRETIONARY_GROUPS.has(group)) return "discretionary";
  return "essential";
}

export const SPEND_CLASS_LABEL: Record<SpendClass, string> = {
  essential: "Essential",
  discretionary: "Discretionary",
};
