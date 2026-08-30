import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { presentSubscriptions } from "@/lib/subscriptions/present";
import { fetchSubscriptions } from "@/lib/subscriptions/fetch";

export const dynamic = "force-dynamic";

/**
 * GET /api/subscriptions — detected recurring charges with monthly/annual
 * roll-ups. Shared contract for the finops CLI, MCP, and PWA. PAT-authenticated.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let rows;
  try {
    rows = await fetchSubscriptions(auth.supabase, auth.householdId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(presentSubscriptions(rows));
}
