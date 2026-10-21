import { NextResponse, type NextRequest } from "next/server";
import { requireCronAuth } from "@/lib/api/cron-auth";
import { sendTelegram, telegramConfigFromEnv } from "@/lib/alerts/telegram";
import { runPollTransactions } from "@/lib/cron/poll-transactions";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const backfill = new URL(request.url).searchParams.get("backfill") === "true";
    return await runPollTransactions({ backfill });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[poll-transactions] cron failed", e);
    await sendTelegram(
      `FinOps cron poll-transactions failed: ${message}`,
      telegramConfigFromEnv(),
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
