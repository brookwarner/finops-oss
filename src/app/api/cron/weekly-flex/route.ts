import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireCronAuth } from "@/lib/api/cron-auth";
import { loadHouseholdIds } from "@/lib/accounts/households";
import { computeBudgets } from "@/lib/budgets/compute";
import { defaultPeriod, toISODate } from "@/lib/budgets/period";
import { insertAlerts } from "@/lib/alerts/load";
import { formatFlexDigest } from "@/lib/alerts/format";
import { sendTelegram, telegramConfigFromEnv } from "@/lib/alerts/telegram";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const supabase = createSupabaseServiceClient();
    const telegram = telegramConfigFromEnv();
    const period = defaultPeriod(new Date());
    const periodStart = toISODate(period.start);

    const { households, error: acctErr } = await loadHouseholdIds(supabase);
    if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });

    const results: Record<string, unknown> = {};
    for (const householdId of households) {
      try {
        const compute = await computeBudgets({ supabase, householdId, period });
        const caps = compute.rows.filter((r) => r.kind === "monthly_cap");
        const body = formatFlexDigest({
          flexAmount: compute.flex.amount,
          capsOver: caps.filter((r) => r.status === "over").length,
          capsWarning: caps.filter((r) => r.status === "warning").length,
        });

        const result = await sendTelegram(body, telegram);
        await insertAlerts(supabase, [{
          household_id: householdId,
          type: "flex_digest",
          category_id: null,
          period_start: periodStart,
          state: null,
          txn_id: null,
          title: "Weekly Flex digest",
          body,
          payload: { flexAmount: compute.flex.amount, categoriesIncluded: compute.flex.categoriesIncluded },
          delivered: result.ok,
          delivery_error: result.ok ? null : result.error ?? "unknown",
        }]);
        results[householdId] = { delivered: result.ok, error: result.error ?? null };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("[weekly-flex] household failed", householdId, message);
        results[householdId] = { error: message };
      }
    }

    return NextResponse.json({ households: households.length, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[weekly-flex] cron failed", e);
    await sendTelegram(
      `FinOps cron weekly-flex failed: ${message}`,
      telegramConfigFromEnv(),
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
