// src/lib/fi/repayment-load.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeFI, type FIResult } from "./compute";
import { computeMortgagePI, type MortgagePI } from "@/lib/mortgage/pi";
import { computeBudgets } from "@/lib/budgets/compute";
import { defaultPeriod } from "@/lib/budgets/period";
import { DOB } from "./constants";
import type { ScenarioPartInput } from "@/lib/mortgage/scenario";
import type { RepaymentFIBase } from "./repayment";

/** Map the mortgage P&I view's amortising tranches to the scenario engine's
 *  minimal per-tranche input. Same filter/shape `loadAllocationInput` uses. */
export function mortgagePartsFromPI(mortgage: MortgagePI): ScenarioPartInput[] {
  return mortgage.parts
    .filter((p) => p.balance > 0 && p.payoff != null)
    .map((p) => ({
      balance: p.balance,
      monthlyPayment: p.payoff!.monthlyPayment,
      annualRate: p.payoff!.annualRatePct,
      refixMonths: p.refixMonths,
    }));
}

/** Pure shaper: FI result + mortgage tranches → the lever-free base. Kept
 *  separate so the /investments page can build it from already-fetched data
 *  without a third compute. */
export function buildRepaymentFIBase(args: {
  fi: FIResult;
  mortgageParts: ScenarioPartInput[];
  now: Date;
  suggestedExtra?: number;
}): RepaymentFIBase {
  return {
    startAssets: args.fi.fiAssets,
    baseContribution: args.fi.monthlyContribution,
    realAnnualReturn: args.fi.assumptions.realReturn,
    fiNumber: args.fi.fiNumber,
    mortgageParts: args.mortgageParts,
    now: args.now,
    dob: DOB,
    suggestedExtra: args.suggestedExtra,
  };
}

/**
 * Assemble the RepaymentFIBase from live data for the API and MCP surfaces.
 *  - FI baseline      ← computeFI
 *  - mortgage tranches ← computeMortgagePI
 *  - suggested extra   ← this cycle's planned spare (computeBudgets position)
 */
export async function loadRepaymentFIBase(args: {
  supabase: SupabaseClient;
  householdId: string;
  now?: Date;
}): Promise<RepaymentFIBase> {
  const { supabase, householdId } = args;
  const now = args.now ?? new Date();
  const period = defaultPeriod(now);

  const [fi, mortgage, budgets] = await Promise.all([
    computeFI({ supabase, householdId, now }),
    computeMortgagePI({ supabase, householdId, now }),
    computeBudgets({ supabase, householdId, period, now }),
  ]);

  return buildRepaymentFIBase({
    fi,
    mortgageParts: mortgagePartsFromPI(mortgage),
    now,
    suggestedExtra: Math.max(0, Math.round(budgets.position.net.planned)),
  });
}
