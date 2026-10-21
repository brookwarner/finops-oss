import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { setInvestmentInception } from "@/lib/holdings/investments";

export const dynamic = "force-dynamic";

// `yyyy-mm-dd`, or null to clear the seed (fall back to observed first_seen).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PATCH /api/investments/inception — set an account's manual "investing since"
 * date, which seeds the annualised-return CAGR for holdings that predate
 * first_seen tracking. Body: { accountId, date: "yyyy-mm-dd" | null }.
 */
export async function PATCH(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    accountId?: unknown;
    date?: unknown;
  };
  const accountId = typeof body.accountId === "string" ? body.accountId : "";
  const date =
    body.date === null || body.date === undefined ? null : String(body.date);

  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }
  if (date !== null && !ISO_DATE.test(date)) {
    return NextResponse.json(
      { error: "date must be yyyy-mm-dd or null" },
      { status: 400 },
    );
  }
  if (date !== null && new Date(date).getTime() > Date.now()) {
    return NextResponse.json({ error: "date cannot be in the future" }, { status: 400 });
  }

  const res = await setInvestmentInception({
    supabase: auth.supabase,
    householdId: auth.householdId,
    accountId,
    date,
  });
  if (!res.ok) {
    const status = res.reason === "account not found" ? 404 : 500;
    return NextResponse.json({ error: res.reason }, { status });
  }
  return NextResponse.json({ ok: true, account: res.name, date });
}
