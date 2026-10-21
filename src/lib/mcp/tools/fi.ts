import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { computeFI } from "@/lib/fi/compute";
import { loadRepaymentFIBase } from "@/lib/fi/repayment-load";
import { simulateRepaymentFI } from "@/lib/fi/repayment";
import { defineTool, householdId, text, type ToolDef } from "./types";

export const fiTools: ToolDef[] = [
  defineTool(
    "get_fi",
    "Financial-independence projection (read-only): FI number = trailing-12mo recurring spend ÷ 4% safe-withdrawal-rate; current FI assets = savings + investment accounts (excludes home, everyday cash, loans, and KiwiSaver until 65). Projects forward in today's dollars at a real return plus the actually-saved monthly contribution (net flow into savings/investment over the last 3 months — not theoretical surplus). Returns % to FI, projected FI year/age vs the age-50 target, and the assumptions. Answers 'when am I financially free?'.",
    {},
    async (_args, extra) => {
      const supabase = createSupabaseServiceClient();
      const r = await computeFI({ supabase, householdId: householdId(extra) });
      return text(r);
    },
  ),

  defineTool(
    "simulate_repayment_fi",
    "Simulate how INCREASING mortgage repayments changes your FI (financial-independence) date. Compares two arms that deploy the same total each month: (1) keep investing the extra, vs (2) put the extra on the mortgage — which clears the loan sooner, then redirects the freed scheduled P&I into investing. Treats the extra as reallocated from investing (a fair like-for-like), holds the FI number constant (conservative re: the mortgage-interest reduction), and works in today's dollars. Returns each arm's FI date/age + mortgage-free date, which arm wins, how many months sooner, and the mortgage interest saved. `extraPerMonth` defaults to this cycle's planned spare when omitted.",
    {
      extraPerMonth: z.number().min(0).optional(),
      lumpSum: z.number().min(0).optional(),
    },
    async (args: { extraPerMonth?: number; lumpSum?: number }, extra) => {
      const supabase = createSupabaseServiceClient();
      const base = await loadRepaymentFIBase({ supabase, householdId: householdId(extra) });
      const extraPerMonth = args.extraPerMonth ?? base.suggestedExtra ?? 0;
      return text(simulateRepaymentFI(base, { extraPerMonth, lumpSum: args.lumpSum ?? 0 }));
    },
  ),
];
