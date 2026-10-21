import { NextResponse } from "next/server";
import { resolveIdentity } from "@/lib/api/identity";
import { revalidateHousehold } from "@/lib/cache/household";
import { cashAllocationSchema } from "@/lib/cash-allocations/contract";
import { CashAllocationConflict, InvalidCashAllocation, loadCashAvailability, saveCashAllocation } from "@/lib/cash-allocations/store";

export const dynamic = "force-dynamic";
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

export async function GET(request: Request) {
  const auth = await resolveIdentity(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await loadCashAvailability(auth.supabase, auth.householdId));
  } catch (e) { return NextResponse.json({ error: message(e) }, { status: 500 }); }
}

export async function POST(request: Request) {
  const auth = await resolveIdentity(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = cashAllocationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid allocation", issues: parsed.error.issues }, { status: 400 });
  try {
    const config = await saveCashAllocation(auth.supabase, auth.householdId, parsed.data);
    revalidateHousehold(auth.householdId);
    return NextResponse.json({ config });
  } catch (e) {
    const status = e instanceof CashAllocationConflict ? 409 : e instanceof InvalidCashAllocation ? 400 : 500;
    return NextResponse.json({ error: message(e) }, { status });
  }
}
