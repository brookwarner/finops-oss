"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireHouseholdId } from "@/lib/auth/household";
import { revalidateHousehold } from "@/lib/cache/household";
import { setInvestmentInception } from "@/lib/holdings/investments";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Set (or clear, with null) an account's manual "investing since" date from the
 * PWA. Cookie session resolves the household; the scoped service-role write then
 * enforces it (mirrors settings/members actions — RLS doesn't grant the cookie
 * user a direct accounts UPDATE).
 */
export async function setInceptionAction(
  accountId: string,
  date: string | null,
): Promise<void> {
  if (!accountId) throw new Error("accountId required");
  if (date !== null && !ISO_DATE.test(date)) throw new Error("date must be yyyy-mm-dd");
  if (date !== null && new Date(date).getTime() > Date.now()) {
    throw new Error("date cannot be in the future");
  }
  const householdId = await requireHouseholdId();
  const supabase = createSupabaseServiceClient();
  const res = await setInvestmentInception({ supabase, householdId, accountId, date });
  if (!res.ok) throw new Error(res.reason);
  revalidateHousehold(householdId);
  revalidatePath("/investments");
}
