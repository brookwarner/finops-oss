import { pollParams, pollBudgetEvents } from "../events";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { defineTool, householdId, text } from "./types";

export const eventTools = [defineTool(
  "get_finops_events",
  "Read budget threshold events. First call with cursor null starts from now; persist the returned cursor for later calls. This tool does not schedule polling or wake an agent. Experimental, replay limited to seven days.",
  pollParams.shape,
  async (args: Parameters<typeof pollBudgetEvents>[2], extra) => text(
    await pollBudgetEvents(createSupabaseServiceClient(), householdId(extra), args),
  ),
)];
