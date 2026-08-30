import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { parseAgentReport } from "@/lib/agent-report/build";
import { deliverMonthlyReview } from "@/lib/agent-report/deliver";
import { defineTool, householdId, text, type ToolDef } from "./types";

// The one WRITE tool on the otherwise read-only FinOps MCP. It exists because the
// monthly-review cloud routine runs in a sandbox that blocks direct egress to
// finops.example.com, but reaches MCP connectors via Anthropic's proxy — so
// the routine submits its digest through here instead of curling the REST endpoint.
// Same delivery path as POST /api/agent-report (deliverMonthlyReview).
export const agentReportTools: ToolDef[] = [
  defineTool(
    "submit_monthly_review",
    "Deliver a finished monthly money-review digest: persists it as a monthly_review alert row and sends it to Telegram. Call this only as the FINAL step of the monthly review routine, after gathering data with the read tools (list_budgets, get_budget_history, get_subscriptions, get_net_worth). Args: title (short summary line), body (the markdown digest), payload (optional structured findings for the in-app feed). Returns { delivered, error? }.",
    {
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(8000),
      payload: z.record(z.string(), z.unknown()).optional(),
    },
    async (
      args: { title: string; body: string; payload?: Record<string, unknown> },
      extra,
    ) => {
      const parsed = parseAgentReport(args);
      if (!parsed.ok) return text({ error: parsed.error });
      const supabase = createSupabaseServiceClient();
      const result = await deliverMonthlyReview({
        supabase,
        householdId: householdId(extra),
        report: parsed.value,
      });
      return text(result);
    },
  ),
];
