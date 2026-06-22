import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { isManualId, mintId, validateAsset, type ManualAssetInput } from "./manual";

export interface ManualAssetLoan {
  annualRate: number;
  anchorBalance: number;
  anchorDate: string;
  repaymentCategoryId: string;
  repaymentCategoryName: string | null;
}

export interface ManualAssetInflow {
  likelihood: "likely" | "uncertain";
  expectedDate: string | null;
  preTax: boolean;
  taxRate: number;
}

export interface ManualAsset {
  id: string;            // akahu_account_id (manual_*)
  name: string;
  institution: string;
  type: string;
  currency: string;
  balance: number;
  refreshedAt: string | null;
  feedsFI: boolean;
  autoRefreshed: boolean; // home is overwritten by the refresh-home-value cron
  loan: ManualAssetLoan | null;
  inflow: ManualAssetInflow | null;
}

const HOME_ID = process.env.HOME_ACCOUNT_KEY ?? "";

function toManualAsset(row: any): ManualAsset {
  const type = row.type as string;
  return {
    id: row.akahu_account_id,
    name: row.name,
    institution: row.institution,
    type,
    currency: row.currency,
    balance: Number(row.balance_current ?? 0),
    refreshedAt: row.refreshed_balance_at ?? null,
    feedsFI: type === "investment" || type === "savings",
    autoRefreshed: row.akahu_account_id === HOME_ID,
    loan: null,
    inflow: null,
  };
}

export async function listManualAssets(args: {
  supabase: SupabaseClient;
  householdId: string;
}): Promise<ManualAsset[]> {
  const db = scopedDb(args.supabase, args.householdId);
  const { data, error } = await db.accounts.select(
    "akahu_account_id, name, institution, type, currency, balance_current, refreshed_balance_at, attributes",
  );
  if (error) throw new Error(error.message);
  const base = (data ?? [])
    .filter((r: any) => isManualId(r.akahu_account_id))
    .map(toManualAsset);

  // Attach loan terms (one query per household, not per row).
  const { data: loans } = await db.amortising_liabilities.select(
    "akahu_account_id, annual_rate, anchor_balance, anchor_date, repayment_category_id",
  );
  const loanRows = (loans ?? []) as any[];
  const catIds = [...new Set(loanRows.map((l) => l.repayment_category_id))];
  const catNames = new Map<string, string>();
  if (catIds.length > 0) {
    const { data: cats } = await db.categories.select("id, name").in("id", catIds);
    for (const c of (cats ?? []) as any[]) catNames.set(c.id, c.name);
  }
  const loanByAcct = new Map<string, ManualAssetLoan>();
  for (const l of loanRows) {
    loanByAcct.set(l.akahu_account_id, {
      annualRate: Number(l.annual_rate),
      anchorBalance: Number(l.anchor_balance),
      anchorDate: l.anchor_date,
      repaymentCategoryId: l.repayment_category_id,
      repaymentCategoryName: catNames.get(l.repayment_category_id) ?? null,
    });
  }

  const { data: inflowRows } = await db.expected_inflows.select(
    "akahu_account_id, likelihood, expected_date, pre_tax, tax_rate",
  );
  const inflowByAcct = new Map<string, ManualAssetInflow>();
  for (const r of (inflowRows ?? []) as any[]) {
    inflowByAcct.set(r.akahu_account_id, {
      likelihood: r.likelihood === "uncertain" ? "uncertain" : "likely",
      expectedDate: r.expected_date ?? null,
      preTax: r.pre_tax === true,
      taxRate: Number(r.tax_rate ?? 0),
    });
  }

  return base
    .map((a: ManualAsset) => ({ ...a, loan: loanByAcct.get(a.id) ?? null, inflow: inflowByAcct.get(a.id) ?? null }))
    .sort((x: ManualAsset, y: ManualAsset) => y.balance - x.balance);
}

export async function upsertManualAsset(args: {
  supabase: SupabaseClient;
  householdId: string;
  input: ManualAssetInput & {
    id?: string;
    loan?: { annualRate: number; repaymentCategoryId: string; anchorDate?: string };
    inflow?: { likelihood?: "likely" | "uncertain"; expectedDate?: string | null; preTax?: boolean; taxRate?: number };
  };
}): Promise<ManualAsset> {
  const v = validateAsset(args.input);
  if (!v.ok) throw new Error(v.error);
  const db = scopedDb(args.supabase, args.householdId);

  let id = args.input.id;
  if (id && !isManualId(id)) throw new Error("id must be a manual_ asset id");
  const nowIso = new Date().toISOString();

  const common = {
    name: v.value.name,
    institution: v.value.institution,
    type: v.value.type,
    currency: v.value.currency,
    balance_current: v.value.balance,
    refreshed_balance_at: nowIso,
  };

  let saved: any;
  if (id) {
    const { data, error } = await db.accounts
      .update(common)
      .eq("akahu_account_id", id)
      .select(
        "akahu_account_id, name, institution, type, currency, balance_current, refreshed_balance_at",
      )
      .single();
    if (error) throw new Error(error.message);
    saved = data;
  } else {
    const existing = await listManualAssets({ supabase: args.supabase, householdId: args.householdId });
    id = mintId(v.value.name, new Set(existing.map((a) => a.id)));
    const { data, error } = await db.accounts
      .insert({ ...common, akahu_account_id: id, attributes: [] })
      .select(
        "akahu_account_id, name, institution, type, currency, balance_current, refreshed_balance_at",
      )
      .single();
    if (error) throw new Error(error.message);
    saved = data;
  }

  // Loan terms: upsert and recompute so the persisted balance is immediately correct.
  if (args.input.loan) {
    // Defence-in-depth (multi-tenant): the repayment category must belong to this
    // household. The /api/assets name path resolves household-scoped, but the
    // id-direct path (PWA/MCP) passes a raw UUID — verify it here so a foreign
    // category id can never be linked. scopedDb injects the household filter.
    const { data: cat, error: cErr } = await db.categories
      .select("id")
      .eq("id", args.input.loan.repaymentCategoryId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!cat) throw new Error("repayment category not found in this household");

    const today = new Date().toISOString().slice(0, 10);
    const { error: lErr } = await db.amortising_liabilities.upsert(
      {
        akahu_account_id: id,
        anchor_balance: Math.abs(v.value.balance),
        anchor_date: args.input.loan.anchorDate ?? today,
        annual_rate: args.input.loan.annualRate,
        repayment_category_id: args.input.loan.repaymentCategoryId,
      },
      { onConflict: "akahu_account_id" },
    );
    if (lErr) throw new Error(lErr.message);
    const { recomputeAmortisingLiabilities } = await import("./recompute");
    await recomputeAmortisingLiabilities({ supabase: args.supabase, householdId: args.householdId });
  }

  if (args.input.inflow && v.value.type === "receivable") {
    const inf = args.input.inflow;
    const { error: iErr } = await db.expected_inflows.upsert(
      {
        akahu_account_id: id,
        likelihood: inf.likelihood === "uncertain" ? "uncertain" : "likely",
        expected_date: inf.expectedDate ?? null,
        pre_tax: inf.preTax === true,
        tax_rate: inf.preTax === true ? Number(inf.taxRate ?? 0) : 0,
      },
      { onConflict: "akahu_account_id" },
    );
    if (iErr) throw new Error(iErr.message);
  }

  const loanList = await listManualAssets({ supabase: args.supabase, householdId: args.householdId });
  const withLoan = loanList.find((a) => a.id === id);
  return withLoan ?? toManualAsset(saved);
}

export async function removeManualAsset(args: {
  supabase: SupabaseClient;
  householdId: string;
  id: string;
}): Promise<void> {
  if (!isManualId(args.id)) throw new Error("refusing to delete a non-manual account");
  // Any amortising_liabilities row is removed automatically by its FK ON DELETE CASCADE — no explicit delete needed.
  const { error } = await scopedDb(args.supabase, args.householdId)
    .accounts.delete()
    .eq("akahu_account_id", args.id);
  if (error) throw new Error(error.message);
}
