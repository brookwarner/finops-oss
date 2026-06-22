import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { parseAgentReport } from "@/lib/agent-report/build";
import { deliverMonthlyReview } from "@/lib/agent-report/deliver";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent-report — sink for the monthly review agent.
 *
 * PAT-authenticated (same credential the agent uses for the MCP connector).
 * Body: { title, body (markdown), payload? }. Persists a `monthly_review`
 * alert row and forwards the body to Telegram. Returns 200 even if Telegram
 * fails — the row records `delivered: false` + `delivery_error`, matching the
 * weekly-flex cron's non-delivery handling. Shares delivery logic with the
 * `submit_monthly_review` MCP tool via `deliverMonthlyReview`.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = parseAgentReport(json);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { delivered, error } = await deliverMonthlyReview({
    supabase: auth.supabase,
    householdId: auth.householdId,
    report: parsed.value,
  });
  return NextResponse.json({ delivered, error });
}
