import { NextResponse, type NextRequest } from "next/server";
import { requireCronAuth } from "@/lib/api/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { dispatchBudgetWebhooks } from "@/lib/mcp/webhook-delivery";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;
  try { return NextResponse.json(await dispatchBudgetWebhooks(createSupabaseServiceClient())); }
  catch { console.error("[mcp-events] dispatcher failed"); return NextResponse.json({ error: "Event dispatch failed" }, { status: 500 }); }
}
