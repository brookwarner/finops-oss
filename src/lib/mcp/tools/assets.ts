import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  listManualAssets,
  upsertManualAsset,
  removeManualAsset,
} from "@/lib/assets/store";
import { resolveCategory } from "@/lib/categories/resolve";
import { defineTool, householdId, text, type ToolDef } from "./types";

export const assetTools: ToolDef[] = [
  defineTool(
    "list_manual_assets",
    "List manually-tracked assets and liabilities that bank feeds can't see (the home, money owed to the user, private/wholesale holdings). These already count toward net worth. Use for 'what manual assets do I track' or before updating one.",
    {},
    async (_args, extra) => {
      const supabase = createSupabaseServiceClient();
      const assets = await listManualAssets({ supabase, householdId: householdId(extra) });
      if (assets.length === 0) return text("No manual assets.");
      const lines = assets.map(
        (a) =>
          `${a.name}: ${a.currency} ${a.balance.toFixed(2)} (${a.type})` +
          `${a.feedsFI ? " [feeds FI]" : ""}${a.autoRefreshed ? " [auto-refreshed]" : ""}` +
          `${a.loan ? ` [loan ${a.loan.annualRate}% via ${a.loan.repaymentCategoryName ?? "?"}${a.loan.anchorDate ? ` as of ${a.loan.anchorDate}` : ""}]` : ""}` +
          `${a.inflow ? ` [inflow ${a.inflow.likelihood}${a.inflow.expectedDate ? ` by ${a.inflow.expectedDate}` : ""}${a.inflow.preTax ? ` ${Math.round(a.inflow.taxRate * 100)}% tax` : ""}]` : ""} — ${a.id}`,
      );
      return text(lines.join("\n"));
    },
  ),
  defineTool(
    "set_manual_asset",
    "Create or update a manual asset/liability. Negative balance = a liability (money owed). Omit id to create; pass a manual_ id to update. type defaults to 'other' (net-worth only); 'investment' or 'savings' additionally feed the FI number. Pass repaymentCategory (+ optional annualRate, default 0) to make it an amortising loan that auto-reduces as repayments in that category post. For a receivable (money you're owed once: tax refund, bonus, late invoice), set type='receivable' with optional likelihood, expectedDate, preTax + taxRate. Pass anchorDate (YYYY-MM-DD) to set the loan's as-of date (default today); the balance you give is the principal owing on that date.",
    {
      name: z.string(),
      balance: z.number(),
      type: z.enum(["other", "investment", "savings", "receivable"]).optional(),
      currency: z.string().optional(),
      id: z.string().optional(),
      annualRate: z.number().optional(),
      repaymentCategory: z.string().optional(),
      anchorDate: z.string().optional(),
      likelihood: z.enum(["likely", "uncertain"]).optional(),
      expectedDate: z.string().optional(),
      preTax: z.boolean().optional(),
      taxRate: z.number().optional(),
    },
    async (args, extra) => {
      const supabase = createSupabaseServiceClient();
      let loan: { annualRate: number; repaymentCategoryId: string; anchorDate?: string } | undefined;
      if (args.repaymentCategory) {
        const r = await resolveCategory(supabase, householdId(extra), args.repaymentCategory);
        if (!r.ok) {
          return text(`Category "${args.repaymentCategory}" ${r.reason === "ambiguous" ? "is ambiguous" : "not found"}.`);
        }
        loan = { annualRate: args.annualRate ?? 0, repaymentCategoryId: r.category.id, anchorDate: args.anchorDate };
      }
      let inflow: { likelihood?: "likely" | "uncertain"; expectedDate?: string | null; preTax?: boolean; taxRate?: number } | undefined;
      if (args.type === "receivable" && (args.likelihood || args.expectedDate || args.preTax !== undefined || args.taxRate !== undefined)) {
        inflow = { likelihood: args.likelihood, expectedDate: args.expectedDate ?? null, preTax: args.preTax, taxRate: args.taxRate };
      }
      const asset = await upsertManualAsset({
        supabase,
        householdId: householdId(extra),
        input: { id: args.id, name: args.name, balance: args.balance, type: args.type, currency: args.currency, loan, inflow },
      });
      return text(`Saved ${asset.name}: ${asset.currency} ${asset.balance.toFixed(2)} (${asset.type}) — ${asset.id}`);
    },
  ),
  defineTool(
    "remove_manual_asset",
    "Delete a manual asset by its manual_ id. Only manual assets can be removed this way; bank-linked accounts are protected.",
    { id: z.string() },
    async (args, extra) => {
      const supabase = createSupabaseServiceClient();
      await removeManualAsset({ supabase, householdId: householdId(extra), id: args.id });
      return text(`Removed ${args.id}.`);
    },
  ),
];
