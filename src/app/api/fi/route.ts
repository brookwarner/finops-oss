import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/auth";
import { computeFI } from "@/lib/fi/compute";
import { getCachedFI } from "@/lib/fi/cached";

export const dynamic = "force-dynamic";

/**
 * GET /api/fi — financial-independence projection. Shared contract for the
 * `finops` CLI and MCP. PAT-authenticated.
 */
export const GET = withAuth(async (request, auth) => {
  const url = new URL(request.url);
  const rr = url.searchParams.get("realReturn");
  const realReturn = rr != null && Number.isFinite(Number(rr)) ? Number(rr) : undefined;
  // Default projection is cached; a realReturn what-if is rare/open-ended → live.
  const result =
    realReturn === undefined
      ? await getCachedFI(auth.householdId)
      : await computeFI({ supabase: auth.supabase, householdId: auth.householdId, realReturn });
  return NextResponse.json(result);
});
