import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { computeMortgagePI } from "@/lib/mortgage/pi";
import { defineTool, householdId, text, type ToolDef } from "./types";

export const mortgageTools: ToolDef[] = [
  defineTool(
    "get_mortgage_pi",
    "Mortgage P&I lens (read-only, not a budget): interest vs principal repaid this calendar year and per amortising tranche, each tranche's rate (contractual when known via mortgage_parts, else estimated from the posted interest charge), fixed-until / refixMonths, and a mortgage-free date. `revolving[]` lists interest-only / non-reducing facilities (real cost, no principal, excluded from the mortgage-free date). totals.otherInterestYtd is that revolving interest. For 'what if I pay extra / refix at X%' use simulate_mortgage_scenario.",
    {},
    async (_args, extra) => {
      const supabase = createSupabaseServiceClient();
      const r = await computeMortgagePI({ supabase, householdId: householdId(extra) });
      return text(r);
    },
  ),

  defineTool(
    "simulate_mortgage_scenario",
    "Model a mortgage what-if for FI / fix-vs-float decisions: an extra recurring repayment, a one-off lump sum, and/or a refix rate applied from each tranche's fixed-until date. Returns the baseline payoff plus the scenario's mortgage-free date, months saved, and lifetime interest saved.",
    {
      extraPerMonth: z.number().min(0).optional(),
      lumpSum: z.number().min(0).optional(),
      refixRate: z.number().min(0).max(30).optional(),
    },
    async (args: { extraPerMonth?: number; lumpSum?: number; refixRate?: number }, extra) => {
      const supabase = createSupabaseServiceClient();
      const r = await computeMortgagePI({ supabase, householdId: householdId(extra), scenario: args });
      return text({
        baseline: r.payoff, scenario: r.scenario,
        parts: r.parts.map((p) => ({
          name: p.name, balance: p.balance, ratePct: p.ratePct,
          fixedUntil: p.fixedUntil, payoff: p.payoff, scenarioPayoff: p.scenarioPayoff,
        })),
      });
    },
  ),
];
