import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { loadCashAvailability, saveCashAllocation } from "@/lib/cash-allocations/store";
import { cashAllocationSchema } from "@/lib/cash-allocations/contract";
import { revalidateHousehold } from "@/lib/cache/household";
import { defineTool, householdId, text, type ToolDef } from "./types";

export const cashAllocationTools: ToolDef[] = [
  defineTool("get_cash_allocations", "Read saved account allocations, latest balances, protected cash and business cash available to pay yourself. Includes account IDs and revisions needed to save. Unpaid invoices and credit are excluded. Upcoming costs must be explicitly allocated before drawing cash.", {}, async (_args, extra) => {
    return text(await loadCashAvailability(createSupabaseServiceClient(), householdId(extra)));
  }),
  defineTool("set_cash_allocations", "Replace one account's allocation plan. Read get_cash_allocations first and use its revision (null for a new plan); stale revisions fail. Mark businessCash to include it in available drawings. Use wholeAccountLabel for a dedicated account OR pots for named fixed amounts (income tax, GST, costs, buffer). To release allocations, clear pots and wholeAccountLabel. Does not move money or calculate tax.", cashAllocationSchema.shape, async (args, extra) => {
    const id = householdId(extra);
    const config = await saveCashAllocation(createSupabaseServiceClient(), id, cashAllocationSchema.parse(args));
    revalidateHousehold(id);
    return text({ config });
  }),
];
