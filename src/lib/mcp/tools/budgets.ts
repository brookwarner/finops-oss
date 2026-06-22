import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { computeBudgets } from "@/lib/budgets/compute";
import { defaultPeriod, parseDate } from "@/lib/budgets/period";
import { getHistory } from "@/lib/budgets/snapshot";
import { getIncomeHistory } from "@/lib/income/history";
import { getDailyBurn } from "@/lib/spend/daily-burn";
import { filterByGroup, findCategory } from "@/lib/budgets/select";
import { resolveCategory } from "@/lib/categories/resolve";
import { setBudgetTarget } from "@/lib/budgets/write";
import { setBudgetTargetSchema } from "@/lib/api/validation";
import { defineTool, householdId, text, type ToolDef } from "./types";

function periodFrom(args: { from?: string; to?: string }) {
  const now = new Date();
  const d = defaultPeriod(now);
  return { start: parseDate(args.from, d.start), end: parseDate(args.to, d.end) };
}

export const budgetTools: ToolDef[] = [
  defineTool(
    "list_budgets",
    "List all budgets for the current (or given) period with spend, %, remaining, and the flex balance. Each budget returns three spend figures: spent (gross cash-out), netSpent (gross minus in-period refunds), and effectiveSpend (the figure pct/status/remaining are computed from). READ effectiveSpend, not netSpent, as 'how much counts against this budget' — they diverge for ap_amortised categories, where effectiveSpend = gross spent so a transfer's far-leg can't deflate it (e.g. a mortgage repayment landing on the loan account is categorised the same as the cash-out, and would otherwise net netSpent down to ~half the real payment). For ordinary monthly_cap categories the two are equal. Reserve (sinking-fund) categories also include reserveBalance — accrued since 2026-01-01 minus spend, negative if overdrawn. Savings-kind categories (e.g. Savings Out, Investments) are contribution goals, not spend caps: netSpent is the money SET ASIDE this cycle toward the monthly target, hitting/exceeding it is success, and there is no reserveBalance. Also returns income: earned so far, planned (budget), recentRunRate (trailing 3-cycle avg), and vsPlan (run-rate minus plan — negative means earning below plan). Returns a structural plan object: plannedExpenses (Σ expense budget caps), plannedIncome (Σ income budgets), and plannedNet (income minus expenses) — answers 'do the budgets I've SET commit me to spending more than I plan to earn?', independent of how this cycle is tracking; negative plannedNet means over-committed budgets. A budget may also carry pendingSpent: unsettled spend already made at the bank but not yet in the settled feed, provisionally attributed to this category from the pending description (NOT in netSpent/pct/status, which stay settled-only). A top-level unallocatedPending is pending spend no rule could attribute. When answering 'can I spend on X right now?', add pendingSpent to netSpent for the true committed position.",
    { from: z.string().optional(), to: z.string().optional(), group: z.string().optional() },
    async (args: { from?: string; to?: string; group?: string }, extra) => {
      const supabase = createSupabaseServiceClient();
      const r = await computeBudgets({ supabase, householdId: householdId(extra), period: periodFrom(args) });
      const rows = filterByGroup(r.rows, args.group);
      return text({
        period: r.period, flex: r.flex, inbox: r.inbox,
        income: {
          earned: r.position.income.actual,
          planned: r.position.income.planned,
          recentRunRate: r.position.income.recentRunRate,
          vsPlan: r.position.income.recentRunRate - r.position.income.planned,
        },
        plan: {
          plannedExpenses: r.position.expenses.budget,
          plannedIncome: r.position.income.planned,
          plannedNet: r.position.net.planned,
        },
        budgets: rows.map((x) => ({
          category: x.category, group: x.group, kind: x.kind, target: x.target,
          spent: x.spent, netSpent: x.netSpent, effectiveSpend: x.effectiveSpend,
          pct: x.pct, remaining: x.remaining, status: x.status,
          ...(x.pendingSpent > 0 ? { pendingSpent: x.pendingSpent } : {}),
          ...(x.kind === "reserve" ? { reserveBalance: x.reserveBalance } : {}),
        })),
        ...(r.unallocatedPending > 0 ? { unallocatedPending: r.unallocatedPending } : {}),
      });
    },
  ),

  defineTool(
    "get_budget_status",
    "How am I going on a specific budget category this period? Best tool for 'can I spend on X right now?'. Returns spent (gross cash-out), netSpent (gross minus in-period refunds), and effectiveSpend (what pct/status/remaining are computed from). Read effectiveSpend, not netSpent, as 'how much counts against this budget' — for ap_amortised categories (e.g. mortgage parts) they diverge because effectiveSpend = gross spent, so a transfer's far-leg landing in the same category (e.g. a loan-account repayment) can't deflate it. If it returns pendingSpent (unsettled charges already made at the bank, provisionally categorised), use netSpentInclPending / remainingInclPending for the true committed position; netSpent/pct/remaining are settled-only and will under-report until those clear.",
    { category: z.string(), from: z.string().optional(), to: z.string().optional() },
    async (args: { category: string; from?: string; to?: string }, extra) => {
      const supabase = createSupabaseServiceClient();
      const r = await computeBudgets({ supabase, householdId: householdId(extra), period: periodFrom(args) });
      const row = findCategory(r.rows, args.category);
      if (!row) return text({ found: false, category: args.category });
      return text({
        found: true, category: row.category, kind: row.kind, target: row.target,
        spent: row.spent, netSpent: row.netSpent, effectiveSpend: row.effectiveSpend,
        reimbursed: row.reimbursed, pct: row.pct, remaining: row.remaining, status: row.status,
        ...(row.pendingSpent > 0
          ? {
              pendingSpent: row.pendingSpent,
              netSpentInclPending: Math.round((row.netSpent + row.pendingSpent) * 100) / 100,
              remainingInclPending: Math.round((row.remaining - row.pendingSpent) * 100) / 100,
            }
          : {}),
        ...(row.kind === "reserve" ? { reserveBalance: row.reserveBalance } : {}),
        daysLeft: r.period.daysLeft, recent: row.recent,
      });
    },
  ),

  defineTool(
    "get_budget_history",
    "Historical budget trend for a category (or all categories) across recent 20th->20th cycles. Read from snapshots — fast.",
    { category: z.string().optional(), limit: z.number().int().min(1).max(36).optional() },
    async (args: { category?: string; limit?: number }, extra) => {
      const supabase = createSupabaseServiceClient();
      const result = await getHistory(supabase, householdId(extra), { category: args.category, limit: args.limit });
      return text(result);
    },
  ),

  defineTool(
    "get_income_history",
    "Income trend across recent 20th->20th cycles: per-cycle total vs planned income, broken down by source (Salary, Partner ECE Income, etc.). Derived from transactions — actual is exact, plan is the current target. Arg: limit (default 12, max 36).",
    { limit: z.number().int().min(1).max(36).optional() },
    async (args: { limit?: number }, extra) => {
      const supabase = createSupabaseServiceClient();
      const result = await getIncomeHistory(supabase, householdId(extra), { limit: args.limit });
      return text(result);
    },
  ),

  defineTool(
    "get_daily_burn",
    "Daily burn pace for the current 20th->20th cycle: how fast variable (monthly_cap) spend is going, day by day, and whether the pace is trending up or down. Returns plannedPerDay (Σ monthly_cap targets ÷ cycle length — the daily allowance), trailingPerDay (avg over the last `trailing` days, default 7), vsPlan (trailing − planned; positive = burning hotter than plan), trend (trailing − prior window; positive = pace rising), cyclePerDay, spentSoFar, and a per-day `days` series (date, spend; refunds net within a day). Scoped to monthly_cap categories — the same discretionary set the forecast drags as daily burn. Arg: trailing (window in days, default 7, max 31).",
    { trailing: z.number().int().min(1).max(31).optional() },
    async (args: { trailing?: number }, extra) => {
      const supabase = createSupabaseServiceClient();
      const result = await getDailyBurn(supabase, householdId(extra), { trailingDays: args.trailing });
      return text(result);
    },
  ),

  defineTool(
    "set_budget_target",
    "Set the monthly target for a budget category. Returns the previous and new target. Refuses if the category has no budget yet.",
    setBudgetTargetSchema.shape,
    async (args: { category: string; monthlyTarget: number }, extra) => {
      const supabase = createSupabaseServiceClient();
      const hid = householdId(extra);
      const res = await resolveCategory(supabase, hid, args.category);
      if (!res.ok) return text({ error: res.reason, candidates: res.candidates.map((c) => c.name) });
      const r = await setBudgetTarget({ supabase, householdId: hid, categoryId: res.category.id, monthlyTarget: args.monthlyTarget });
      if (!r.ok) return text({ error: "no-budget", category: res.category.name });
      return text({ category: res.category.name, previousTarget: r.previousTarget, newTarget: r.newTarget });
    },
  ),
];
