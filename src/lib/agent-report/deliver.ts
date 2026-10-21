// Delivery orchestration for the monthly review agent, shared by the REST route
// (`POST /api/agent-report`) and the MCP tool (`submit_monthly_review`). Keeping
// it in one place means both surfaces persist + deliver identically. The pure
// validation/mapping lives in build.ts (unit-tested); this is the I/O glue,
// exercised via the verification checklist (mirrors src/lib/alerts/load.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAlerts } from "@/lib/alerts/load";
import { sendTelegram, telegramConfigFromEnv } from "@/lib/alerts/telegram";
import { defaultPeriod, toISODate } from "@/lib/budgets/period";
import { buildMonthlyReviewRow, type AgentReport } from "./build";

export interface DeliveryResult {
  delivered: boolean;
  error?: string;
}

/**
 * Persist a validated monthly-review report as a `monthly_review` alert row and
 * forward it to Telegram. Never throws on a Telegram failure — the row records
 * `delivered: false` + `delivery_error`. A DB insert failure DOES throw (the row
 * is the durable deliverable; callers surface that as an error).
 */
export async function deliverMonthlyReview(args: {
  supabase: SupabaseClient;
  householdId: string;
  report: AgentReport;
}): Promise<DeliveryResult> {
  const { supabase, householdId, report } = args;
  const result = await sendTelegram(report.body, telegramConfigFromEnv());
  const row = buildMonthlyReviewRow({
    householdId,
    periodStart: toISODate(defaultPeriod(new Date()).start),
    title: report.title,
    body: report.body,
    payload: report.payload,
    delivered: result.ok,
    deliveryError: result.ok ? null : result.error ?? "unknown",
  });
  await insertAlerts(supabase, [row]);
  return { delivered: result.ok, error: result.ok ? undefined : result.error };
}
