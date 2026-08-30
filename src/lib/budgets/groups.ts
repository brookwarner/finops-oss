// src/lib/budgets/groups.ts
//
// The canonical display order for budget groups. Groups are a free-text column on
// `categories`, so this list is presentation only: it pins the familiar groups to a
// stable order and lets anything else fall in alphabetically behind them.
//
// Single source of truth — the /budgets page sections its budget list by it and the
// /settings/classification group editor orders its picker by it. A second copy would
// drift the moment a group is added.

export const GROUP_ORDER: string[] = [
  "Income",
  "Food",
  "Discretionary",
  "Kids",
  "Wellbeing",
  "Transit",
  "Maintenance",
  "Utilities",
  "Fixed",
  "Mortgage",
  "Investments",
  "Savings",
  "Business",
  "System",
];

/**
 * Order a set of group names: known groups first in GROUP_ORDER, then any unknown
 * group alphabetically. Pure; input is not mutated.
 */
export function orderGroups(groups: Iterable<string>): string[] {
  const seen = new Set(groups);
  const known = GROUP_ORDER.filter((g) => seen.has(g));
  const unknown = [...seen].filter((g) => !GROUP_ORDER.includes(g)).sort((a, b) => a.localeCompare(b));
  return [...known, ...unknown];
}
