import { NextResponse, type NextRequest } from "next/server";
import { resolveIdentity } from "@/lib/api/identity";
import { acceptSuggestions } from "@/lib/transactions/write";
import { revalidateHousehold } from "@/lib/cache/household";

export async function POST(request: NextRequest) {
  const auth = await resolveIdentity(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { transactionIds?: string[] };
  try {
    const result = await acceptSuggestions({
      supabase: auth.supabase, householdId: auth.householdId,
      transactionIds: body.transactionIds,
    });
    revalidateHousehold(auth.householdId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
