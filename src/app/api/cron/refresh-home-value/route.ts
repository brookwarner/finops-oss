import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireCronAuth } from "@/lib/api/cron-auth";
import { fetchHomesEstimate } from "@/lib/homes/estimate";
import { sendTelegram, telegramConfigFromEnv } from "@/lib/alerts/telegram";
import { env } from "@/lib/env";

// Monthly refresh of the manual home asset from its homes.co.nz HomesEstimate.
// The home is stored as an `accounts` row keyed by a synthetic akahu_account_id
// (the column is not-null/unique); type 'other' makes it count as a net-worth asset.
// Set HOME_PROPERTY_ID + HOME_ACCOUNT_KEY env vars to enable; cron no-ops when unset.

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const HOME_PROPERTY_ID = env.HOME_PROPERTY_ID;
  const HOME_ACCOUNT_KEY = env.HOME_ACCOUNT_KEY;

  if (!HOME_PROPERTY_ID || !HOME_ACCOUNT_KEY) {
    // Not configured for this deployment — skip cleanly rather than querying a
    // stranger's property or erroring. Set HOME_PROPERTY_ID + HOME_ACCOUNT_KEY to enable.
    return NextResponse.json({ skipped: true, reason: "HOME_PROPERTY_ID / HOME_ACCOUNT_KEY not configured" });
  }

  try {
    let estimate;
    try {
      estimate = await fetchHomesEstimate(HOME_PROPERTY_ID);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "homes.co.nz fetch failed" },
        { status: 502 },
      );
    }

    const supabase = createSupabaseServiceClient();
    // scoped-db-exempt: updates the single manual home asset keyed by its unique
    // synthetic akahu_account_id; no householdId is in scope in this ops cron.
    const { data, error } = await supabase
      .from("accounts")
      .update({
        balance_current: estimate.value,
        refreshed_balance_at: new Date().toISOString(),
      })
      .eq("akahu_account_id", HOME_ACCOUNT_KEY)
      .select("id, name, balance_current");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: `home account '${HOME_ACCOUNT_KEY}' not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      updated: data[0].name,
      value: estimate.value,
      range: [estimate.lower, estimate.upper],
      revisionDate: estimate.revisionDate,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[refresh-home-value] cron failed", e);
    await sendTelegram(
      `FinOps cron refresh-home-value failed: ${message}`,
      telegramConfigFromEnv(),
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
