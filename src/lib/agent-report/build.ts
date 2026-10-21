// Pure helpers behind POST /api/agent-report. Validation + row mapping live here
// (unit-tested); the route is thin glue exercised via the verification checklist,
// mirroring src/lib/alerts/load.ts.

import { z } from "zod";
import type { AlertRow } from "@/lib/alerts/run";

export const agentReportInputSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export interface AgentReport {
  title: string;
  body: string;
  payload: Record<string, unknown>;
}

export type ParseResult =
  | { ok: true; value: AgentReport }
  | { ok: false; error: string };

/** Validate an untrusted JSON body into an AgentReport (payload defaults to {}). */
export function parseAgentReport(input: unknown): ParseResult {
  const r = agentReportInputSchema.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "invalid body" };
  return { ok: true, value: { title: r.data.title, body: r.data.body, payload: r.data.payload ?? {} } };
}

/** Map a validated report + delivery outcome to a monthly_review AlertRow. */
export function buildMonthlyReviewRow(args: {
  householdId: string;
  periodStart: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  delivered: boolean;
  deliveryError: string | null;
}): AlertRow {
  return {
    household_id: args.householdId,
    type: "monthly_review",
    category_id: null,
    period_start: args.periodStart,
    state: null,
    txn_id: null,
    title: args.title,
    body: args.body,
    payload: args.payload,
    delivered: args.delivered,
    delivery_error: args.deliveryError,
  };
}
