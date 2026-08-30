import { NextResponse, type NextRequest } from "next/server";
import { resolveIdentity } from "@/lib/api/identity";
import {
  listManualAssets,
  upsertManualAsset,
  removeManualAsset,
} from "@/lib/assets/store";
import { resolveCategory } from "@/lib/categories/resolve";

export const dynamic = "force-dynamic";

/** GET /api/assets — list manual assets (home, receivables, holdings Akahu
 * can't see). Shared contract for the finops CLI, MCP, and PWA. */
export async function GET(request: NextRequest) {
  const auth = await resolveIdentity(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const assets = await listManualAssets({ supabase: auth.supabase, householdId: auth.householdId });
    return NextResponse.json({ assets });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 500 });
  }
}

/** POST /api/assets — create (no id) or update (manual_ id) a manual asset. */
export async function POST(request: NextRequest) {
  const auth = await resolveIdentity(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    let loan: { annualRate: number; repaymentCategoryId: string; anchorDate?: string } | undefined;
    if (body.loan) {
      const annualRate = Number(body.loan.annualRate ?? 0);
      const anchorDate = body.loan.anchorDate ? String(body.loan.anchorDate) : undefined;
      if (body.loan.repaymentCategoryId) {
        loan = { annualRate, repaymentCategoryId: String(body.loan.repaymentCategoryId), anchorDate };
      } else if (body.loan.repaymentCategory) {
        const r = await resolveCategory(auth.supabase, auth.householdId, String(body.loan.repaymentCategory));
        if (!r.ok) {
          return NextResponse.json(
            { error: `category "${body.loan.repaymentCategory}" ${r.reason === "ambiguous" ? "is ambiguous" : "not found"}` },
            { status: 400 },
          );
        }
        loan = { annualRate, repaymentCategoryId: r.category.id, anchorDate };
      } else {
        return NextResponse.json({ error: "loan requires a repaymentCategory" }, { status: 400 });
      }
    }
    let inflow: { likelihood?: "likely" | "uncertain"; expectedDate?: string | null; preTax?: boolean; taxRate?: number } | undefined;
    if (body.inflow) {
      inflow = {
        likelihood: body.inflow.likelihood === "uncertain" ? "uncertain" : "likely",
        expectedDate: body.inflow.expectedDate ?? null,
        preTax: body.inflow.preTax === true,
        taxRate: Number(body.inflow.taxRate ?? 0),
      };
    }
    const asset = await upsertManualAsset({
      supabase: auth.supabase,
      householdId: auth.householdId,
      input: {
        id: body.id,
        name: body.name,
        balance: body.balance,
        type: body.type,
        currency: body.currency,
        institution: body.institution,
        loan,
        inflow,
      },
    });
    return NextResponse.json({ asset });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 400 });
  }
}

/** DELETE /api/assets?id=manual_xxx */
export async function DELETE(request: NextRequest) {
  const auth = await resolveIdentity(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  try {
    await removeManualAsset({ supabase: auth.supabase, householdId: auth.householdId, id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 400 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
