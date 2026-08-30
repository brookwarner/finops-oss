import type { SupabaseClient } from "@supabase/supabase-js";
import { setBudgetTarget } from "@/lib/budgets/write";
import { categoriseTransactions, acceptSuggestions } from "@/lib/transactions/write";
import type { ResolvedAction } from "./types";

/** Apply a confirmed action via the existing write libs. Returns a result line. */
export async function applyAction(supabase: SupabaseClient, householdId: string, a: ResolvedAction): Promise<string> {
  switch (a.kind) {
    case "set_budget_target": {
      const r = await setBudgetTarget({ supabase, householdId, categoryId: a.categoryId, monthlyTarget: a.monthlyTarget });
      if (!r.ok) return `⚠️ ${a.categoryName} has no budget to update.`;
      return `✅ ${a.categoryName} cap set to $${Math.round(a.monthlyTarget).toLocaleString("en-NZ")}.`;
    }
    case "recategorise": {
      await categoriseTransactions({ supabase, householdId, transactionIds: [a.transactionId], categoryId: a.categoryId });
      return `✅ Moved ${a.txnLabel} → ${a.categoryName}.`;
    }
    case "accept_suggestions": {
      const r = await acceptSuggestions({ supabase, householdId, transactionIds: a.transactionIds });
      return `✅ Accepted ${r.accepted} suggestion(s) in ${a.categoryName}.`;
    }
  }
}
