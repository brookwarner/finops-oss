import { NextResponse, type NextRequest } from "next/server";
import { requireCronAuth } from "@/lib/api/cron-auth";
import { sendTelegram, telegramConfigFromEnv } from "@/lib/alerts/telegram";
import { runNightly } from "@/lib/cron/nightly";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    return await runNightly();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[nightly] cron failed", e);
    await sendTelegram(
      `FinOps cron nightly failed: ${message}`,
      telegramConfigFromEnv(),
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
