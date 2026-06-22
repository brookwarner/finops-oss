import type { BudgetStatusRow } from "./compute";

/**
 * Filter budget rows by group name (case-insensitive). Returns all rows when
 * `group` is falsy. Shared by the REST `/api/budgets` route and the MCP
 * `list_budgets` tool so the two surfaces can't drift.
 */
export function filterByGroup<T extends { group?: string | null }>(
  rows: T[],
  group: string | null | undefined,
): T[] {
  if (!group) return rows;
  const g = group.toLowerCase();
  return rows.filter((x) => x.group?.toLowerCase() === g);
}

/**
 * Single-category lookup: exact (case-insensitive) match first, then the first
 * substring match. Returns `undefined` when nothing matches. Shared by the REST
 * `/api/budgets?category=` path and the MCP `get_budget_status` tool.
 */
export function findCategory<T extends { category: string }>(
  rows: T[],
  category: string,
): T | undefined {
  const q = category.toLowerCase();
  return (
    rows.find((x) => x.category.toLowerCase() === q) ??
    rows.find((x) => x.category.toLowerCase().includes(q))
  );
}

export type { BudgetStatusRow };
