/**
 * Canonical UUID regex. Shared so the transaction write paths and any route
 * that needs to validate an id check against the same pattern.
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Re-exported from schemas/ so existing import paths keep working.
export { setBudgetTargetSchema, type SetBudgetTargetInput } from "@/lib/api/schemas/budgets";
