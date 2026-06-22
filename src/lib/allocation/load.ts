// src/lib/allocation/load.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { computeBudgets, type BudgetComputeResult } from "@/lib/budgets/compute";
import { computeMortgagePI } from "@/lib/mortgage/pi";
import { computeFI } from "@/lib/fi/compute";
import { computeEmergencyFund } from "@/lib/buffer/compute";
import { defaultPeriod } from "@/lib/budgets/period";
import { DOB } from "@/lib/fi/constants";
import type { ScenarioPartInput } from "@/lib/mortgage/scenario";
import { VISA_APR, CHOICES_REVOLVING_RATE, ASSUMED_INFLATION } from "./constants";
import type { AllocationInput } from "./compute";

/**
 * Assemble the AllocationInput from live data. Shared by the /investments page
 * (server component) and GET /api/allocation so the two can never diverge.
 *  - surplus + reserve shortfalls ← computeBudgets (position.net.planned, rows)
 *  - mortgage tranches            ← computeMortgagePI
 *  - FI baseline                  ← computeFI
 *  - Visa balance                 ← accounts (type credit_card)
 */
export async function loadAllocationInput(args: {
  supabase: SupabaseClient;
  householdId: string;
  now?: Date;
  /** Pass a pre-computed budgets result to avoid recomputing it (the /budgets
   *  page already has one). Omit on surfaces that don't — it's computed then. */
  budgets?: BudgetComputeResult;
}): Promise<AllocationInput> {
  const { supabase, householdId } = args;
  const now = args.now ?? new Date();
  const db = scopedDb(supabase, householdId);
  const period = defaultPeriod(now);

  const [budgets, mortgage, fi, emergency, accountsRes] = await Promise.all([
    args.budgets ?? computeBudgets({ supabase, householdId, period, now }),
    computeMortgagePI({ supabase, householdId, now }),
    computeFI({ supabase, householdId, now }),
    computeEmergencyFund({ supabase, householdId, now }),
    db.accounts.select("type, balance_current"),
  ]);
  if (accountsRes.error) throw new Error(accountsRes.error.message);

  // Visa: sum credit_card balances (stored negative = owed). Magnitude > 0 ⇒ a balance.
  const accounts = (accountsRes.data ?? []) as Array<{ type: string; balance_current: number | string | null }>;
  const cardOwed = accounts
    .filter((a) => a.type === "credit_card")
    .reduce((s, a) => s + Math.max(0, -Number(a.balance_current ?? 0)), 0);
  const visa = cardOwed > 0 ? { balance: cardOwed, apr: VISA_APR } : null;

  // Revolving facility (Westpac Choices): a redrawable, non-reducing loan the
  // mortgage P&I view surfaces as a caveat (never amortised). Its balance is a
  // positive magnitude owed. The floating rate isn't in Akahu, so it's a
  // configured constant. Sum any with a balance; name from the first.
  const revolvingOwed = mortgage.revolving
    .filter((r) => r.balance > 0)
    .reduce((s, r) => s + r.balance, 0);
  const revolvingLoan =
    revolvingOwed > 0
      ? {
          name: mortgage.revolving.find((r) => r.balance > 0)?.name ?? "Revolving loan",
          balance: revolvingOwed,
          rate: CHOICES_REVOLVING_RATE,
        }
      : null;

  // Behind reserves: reserveBalance < 0 ⇒ shortfall = −balance.
  const reserves = budgets.rows
    .filter((r) => r.kind === "reserve" && r.reserveBalance != null && r.reserveBalance < 0)
    .map((r) => ({ name: r.category, shortfall: -(r.reserveBalance as number) }));

  const mortgageParts: ScenarioPartInput[] = mortgage.parts
    .filter((p) => p.balance > 0 && p.payoff != null)
    .map((p) => ({
      balance: p.balance,
      monthlyPayment: p.payoff!.monthlyPayment,
      annualRate: p.payoff!.annualRatePct,
      refixMonths: p.refixMonths,
    }));

  return {
    surplusPerMonth: Math.max(0, budgets.position.net.planned),
    lumpSum: 0,
    visa,
    revolvingLoan,
    reserves,
    emergencyFund:
      emergency.configured && emergency.accountName
        ? {
            name: emergency.accountName,
            shortfall: emergency.shortfall,
            targetMonths: emergency.targetMonths,
            monthsCovered: emergency.monthsCovered,
          }
        : null,
    mortgageParts,
    fi: {
      vsTargetYears: fi.vsTargetYears,
      monthlyContribution: fi.monthlyContribution,
      startAssets: fi.fiAssets,
      fiNumber: fi.fiNumber,
      realReturn: fi.assumptions.realReturn,
      dob: DOB,
    },
    assumedInflation: ASSUMED_INFLATION,
    now,
  };
}
