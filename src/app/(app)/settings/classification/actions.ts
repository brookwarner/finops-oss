"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireHouseholdId } from "@/lib/auth/household";
import { revalidateHousehold } from "@/lib/cache/household";
import { setIncomeType } from "@/lib/income/sources";
import { INCOME_TYPES, type IncomeType } from "@/lib/income/classify";
import { setSpendClass } from "@/lib/spend/sources";
import { SPEND_CLASSES, type SpendClass } from "@/lib/spend/classify";

/**
 * Classify an income source (salary / recurring / irregular / one-off) from the
 * PWA. Cookie session resolves the household; the scoped service-role write then
 * enforces it (RLS doesn't grant the cookie user a direct categories UPDATE). The
 * classification feeds the forecast (what to project forward) and the runway
 * (salaried?).
 */
export async function setIncomeTypeAction(
  categoryId: string,
  incomeType: IncomeType,
): Promise<void> {
  if (!categoryId) throw new Error("categoryId required");
  if (!INCOME_TYPES.includes(incomeType)) throw new Error("invalid income type");
  const householdId = await requireHouseholdId();
  const supabase = createSupabaseServiceClient();
  const res = await setIncomeType({ supabase, householdId, categoryId, incomeType });
  if (!res.ok) throw new Error(res.reason);
  revalidateHousehold(householdId);
  revalidatePath("/settings/classification");
  revalidatePath("/budgets");
  revalidatePath("/forecast");
}

/**
 * Classify a spend category (essential / discretionary) from the PWA. Same
 * session→service-role write path as income above. The classification feeds the
 * cashflow game-plan's bare-essentials floor and discretionary cut lever.
 */
export async function setSpendClassAction(
  categoryId: string,
  spendClass: SpendClass,
): Promise<void> {
  if (!categoryId) throw new Error("categoryId required");
  if (!SPEND_CLASSES.includes(spendClass)) throw new Error("invalid spend class");
  const householdId = await requireHouseholdId();
  const supabase = createSupabaseServiceClient();
  const res = await setSpendClass({ supabase, householdId, categoryId, spendClass });
  if (!res.ok) throw new Error(res.reason);
  revalidateHousehold(householdId);
  revalidatePath("/settings/classification");
  revalidatePath("/budgets");
  revalidatePath("/forecast");
}
