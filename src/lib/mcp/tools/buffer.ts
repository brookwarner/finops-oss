import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { computeEmergencyFund } from "@/lib/buffer/compute";
import { defineTool, householdId, text, type ToolDef } from "./types";

export const bufferTools: ToolDef[] = [
  defineTool(
    "get_emergency_fund",
    "Emergency fund (cash buffer) status (read-only): a sized stock of liquid cash for income shocks / surprises — distinct from sinking-fund reserves (earmarked for known costs), the savings contribution goal (a flow), and FI investments (long-term). Target = N months × essential monthly spend (from categories.spend_class = 'essential'); balance = the designated `is_emergency_fund` account. Returns target, balance, shortfall, months covered, and % funded. `configured: false` ⇒ no account designated yet (designate one on the /connect page).",
    {},
    async (_args, extra) => {
      const supabase = createSupabaseServiceClient();
      const r = await computeEmergencyFund({ supabase, householdId: householdId(extra) });
      return text(r);
    },
  ),
];
