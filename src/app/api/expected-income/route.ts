import { NextResponse } from "next/server";
import { withAuth, withValidated } from "@/lib/api/auth";
import { snapshotSchema } from "@/lib/expected-income/contract";
import { readSnapshot, saveSnapshot, SnapshotConflict } from "@/lib/expected-income/store";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request, auth) => {
  const stored = await readSnapshot(auth.supabase, auth.householdId);
  return NextResponse.json({ enabled: process.env.EXPECTED_INCOME_ENABLED === "true", ...stored });
});

export const POST = withValidated({ body: snapshotSchema }, async (_request, { auth, input }) => {
  try {
    await saveSnapshot(auth.supabase, auth.householdId, input.body);
    return NextResponse.json({ ok: true, source: input.body.source, count: input.body.payments.length });
  } catch (error) {
    if (error instanceof SnapshotConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "expected income could not be stored" }, { status: 500 });
  }
});
