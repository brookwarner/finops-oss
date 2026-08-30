import { NextResponse, type NextRequest } from "next/server";
import { resolveIdentity } from "@/lib/api/identity";
import { resolveCategory } from "@/lib/categories/resolve";
import { applySimilar } from "@/lib/transactions/write";
import { revalidateHousehold } from "@/lib/cache/household";
import { UUID_RE } from "@/lib/uuid";

export async function POST(request: NextRequest) {
  const auth = await resolveIdentity(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    merchant?: string; categoryId?: string; category?: string;
  };
  if (!body.merchant) {
    return NextResponse.json({ error: "merchant required" }, { status: 400 });
  }

  let categoryId: string;
  if (body.category !== undefined) {
    const res = await resolveCategory(auth.supabase, auth.householdId, body.category);
    if (!res.ok) {
      return NextResponse.json({ error: res.reason, candidates: res.candidates.map((c) => c.name) }, { status: 400 });
    }
    categoryId = res.category.id;
  } else if (body.categoryId && UUID_RE.test(body.categoryId)) {
    categoryId = body.categoryId;
  } else {
    return NextResponse.json({ error: "valid categoryId or category required" }, { status: 400 });
  }

  try {
    const result = await applySimilar({
      supabase: auth.supabase, householdId: auth.householdId,
      merchant: body.merchant, categoryId,
    });
    revalidateHousehold(auth.householdId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
