import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { computeCashflow } from "@/lib/cashflow/compute";
import { defineTool, householdId, text, type ToolDef } from "./types";

export const cashflowTools: ToolDef[] = [
  defineTool(
    "simulate_cashflow",
    "Cashflow game-plan (read-only): when does liquid cash run out, and when does revolving credit headroom run out? Returns `startLiquid` (liquid cash now), `creditHeadroom` (available revolving credit + overdraft), `inflows` (expected one-off money you're owed: id, label, amount, likelihood, expectedDate, taxRate — each lands net of its own tax), a next-bills verdict (can you clear the next bill cluster?), and four scenario lines each with `cashZeroDate` (when liquid cash hits $0), `creditZeroDate` (when the revolving facility's headroom is exhausted — the real wall), and `weeksToCredit`: actual pace (recent real spend), on budget (your targets), bare essentials (discretionary spend paused — only unavoidable costs), and custom (discretionary cut by `cut`%). Income is projected the same way the forecast does it (salary + recurring that's actually still landing); a stopped salary is not assumed to continue. Toggles: cut (% off discretionary, custom line), income (hypothetical extra $/week), lump (assume every inflow lands at its expected date).",
    {
      cut: z.number().min(0).max(100).optional(),
      income: z.number().min(0).optional(),
      lump: z.boolean().optional(),
    },
    async (args: { cut?: number; income?: number; lump?: boolean }, extra) => {
      const supabase = createSupabaseServiceClient();
      const today = new Date().toISOString().slice(0, 10);
      const r0 = await computeCashflow({ supabase, householdId: householdId(extra), toggles: { customCutPct: args.cut, addIncomeWeekly: args.income } });
      const lumps = args.lump ? Object.fromEntries(r0.inflows.map((i) => [i.id, i.expectedDate ?? today])) : undefined;
      const r = lumps ? await computeCashflow({ supabase, householdId: householdId(extra), toggles: { customCutPct: args.cut, addIncomeWeekly: args.income, lumps } }) : r0;
      return text({
        startLiquid: r.startLiquid, creditHeadroom: r.creditHeadroom, inflows: r.inflows,
        nextBills: r.nextBills, verdict: r.verdict,
        lines: r.lines.map((l) => ({ key: l.key, label: l.label, cashZeroDate: l.cashZeroDate, creditZeroDate: l.creditZeroDate, weeksToCredit: l.weeksToCredit })),
      });
    },
  ),
];
