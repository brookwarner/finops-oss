import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireCronAuth } from "@/lib/api/cron-auth";
import { computeBudgets } from "@/lib/budgets/compute";
import { defaultPeriod } from "@/lib/budgets/period";
import { lastNCycles, snapshotRecordsFromResult, upsertSnapshots } from "@/lib/budgets/snapshot";
import { sendTelegram, telegramConfigFromEnv } from "@/lib/alerts/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Budget-period snapshots.
 *   ?backfill=true -> recompute + upsert the last 12 cycles (one-time history fill).
 *   default        -> snapshot only the current cycle (nightly safety-net for a
 *                     missed poll run).
 * CRON_SECRET bearer auth, matching the other cron routes.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const backfill = new URL(request.url).searchParams.get("backfill") === "true";
    const supabase = createSupabaseServiceClient();

    const { data: households, error } = await supabase.from("households").select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const cycles = backfill ? lastNCycles(new Date(), 12) : [defaultPeriod(new Date())];
    let snapshots = 0;
    for (const householdId of (households ?? []).map((h) => h.id)) {
      for (const period of cycles) {
        const result = await computeBudgets({ supabase, householdId, period });
        const records = snapshotRecordsFromResult(result, householdId);
        await upsertSnapshots(supabase, records);
        snapshots += records.length;
      }
    }

    return NextResponse.json({ backfill, cycles: cycles.length, snapshots });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[snapshot-budgets] cron failed", e);
    await sendTelegram(
      `FinOps cron snapshot-budgets failed: ${message}`,
      telegramConfigFromEnv(),
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
