import type { ScopedDb } from "@/lib/supabase/scoped";

/**
 * The category-picker option list (id + name + group), grouped then alphabetised.
 * Shared select+order behind both the Transactions and Inbox pages so the
 * dropdown is identical on each. Routed through the household-scoped accessor so
 * the `household_id` filter is applied automatically.
 */
export function categoryOptionsQuery(db: ScopedDb) {
  return db.categories.select("id, name, group").order("group").order("name");
}
