import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { fetchSubscriptions } from "@/lib/subscriptions/fetch";
import { presentSubscriptions } from "@/lib/subscriptions/present";
import { defineTool, householdId, text, type ToolDef } from "./types";

export const subscriptionTools: ToolDef[] = [
  defineTool(
    "get_subscriptions",
    "List the user's detected recurring subscriptions with per-item monthly/annual cost and total monthly subscription spend. Use for questions like 'what am I subscribed to' or 'how much do my subscriptions cost per month'.",
    {},
    async (_args, extra) => {
      const supabase = createSupabaseServiceClient();
      const rows = await fetchSubscriptions(supabase, householdId(extra));
      return text(presentSubscriptions(rows));
    },
  ),
];
