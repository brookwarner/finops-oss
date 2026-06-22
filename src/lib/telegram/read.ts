import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBudgets } from "@/lib/budgets/compute";
import { defaultPeriod } from "@/lib/budgets/period";
import { computeNetWorth } from "@/lib/networth/compute";
import { fetchSubscriptions } from "@/lib/subscriptions/fetch";
import { presentSubscriptions } from "@/lib/subscriptions/present";
import { recentTransactions } from "@/lib/transactions/query";
import type { ReadQuery } from "./types";

const nz = (n: number) => "$" + Math.round(n).toLocaleString("en-NZ");

export async function runReadQuery(supabase: SupabaseClient, householdId: string, q: ReadQuery): Promise<string> {
  switch (q.kind) {
    case "net_worth": {
      const r = await computeNetWorth({ supabase, householdId });
      return `Net worth *${nz(r.net)}* (assets ${nz(r.assets)} · liabilities ${nz(Math.abs(r.liabilities))}).`;
    }
    case "subscriptions": {
      const subs = presentSubscriptions(await fetchSubscriptions(supabase, householdId));
      return `*${subs.totals.count}* active subs · *${nz(subs.totals.monthly)}*/mo (${nz(subs.totals.annual)}/yr).`;
    }
    case "budget_status": {
      const r = await computeBudgets({ supabase, householdId, period: defaultPeriod(new Date()) });
      const row = r.rows.find((x) => x.category.toLowerCase() === q.category.toLowerCase())
        ?? r.rows.find((x) => x.category.toLowerCase().includes(q.category.toLowerCase()));
      if (!row) return `I couldn't find a budget called "${q.category}".`;
      return `*${row.category}* — ${nz(row.netSpent)} of ${nz(row.target)} (${row.pct}%), ${nz(row.remaining)} left.`;
    }
    case "budgets": {
      const r = await computeBudgets({ supabase, householdId, period: defaultPeriod(new Date()) });
      const over = r.rows.filter((x) => x.status === "over").map((x) => x.category);
      return over.length ? `Over this cycle: *${over.join(", ")}*. Flex ${nz(r.flex.amount)}.` : `All caps on track. Flex ${nz(r.flex.amount)}.`;
    }
    case "forecast":
      return "Forecast: open the app's Forecast tab for the full projection.";
    case "recent": {
      const rows = await recentTransactions({ supabase, householdId, limit: q.limit ?? 5, categoryName: q.category });
      if (rows.length === 0) return "No recent transactions found.";
      return rows.map((t) => `• ${t.merchant ?? t.description ?? "—"} ${nz(t.amount)}`).join("\n");
    }
  }
}
