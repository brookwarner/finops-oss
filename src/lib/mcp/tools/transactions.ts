import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recentTransactions, searchTransactions } from "@/lib/transactions/query";
import { resolveCategory } from "@/lib/categories/resolve";
import { categoriseTransactions, applySimilar, acceptSuggestions } from "@/lib/transactions/write";
import { defineTool, householdId, text, type ToolDef } from "./types";

export const transactionTools: ToolDef[] = [
  defineTool(
    "get_recent_transactions",
    "Recent transactions, optionally filtered by category or since a date.",
    { category: z.string().optional(), limit: z.number().int().min(1).max(100).optional(), since: z.string().optional() },
    async (args: { category?: string; limit?: number; since?: string }, extra) => {
      const supabase = createSupabaseServiceClient();
      const rows = await recentTransactions({ supabase, householdId: householdId(extra), limit: args.limit, since: args.since, categoryName: args.category });
      return text({ transactions: rows });
    },
  ),

  defineTool(
    "search_transactions",
    "Search transactions by merchant or description text.",
    { query: z.string().min(1), limit: z.number().int().min(1).max(100).optional() },
    async (args: { query: string; limit?: number }, extra) => {
      const supabase = createSupabaseServiceClient();
      const rows = await searchTransactions({ supabase, householdId: householdId(extra), query: args.query, limit: args.limit });
      return text({ transactions: rows });
    },
  ),

  defineTool(
    "categorise_transactions",
    "Assign a category to one or more transactions (by id, from get_recent_transactions/search_transactions). Learns a rule from a single categorisation. Returns updated count and similarCount — other uncategorised transactions the new rule would match; call apply_similar to include them.",
    { transactionIds: z.array(z.string()).min(1), category: z.string().min(1) },
    async (args: { transactionIds: string[]; category: string }, extra) => {
      const supabase = createSupabaseServiceClient();
      const hid = householdId(extra);
      const res = await resolveCategory(supabase, hid, args.category);
      if (!res.ok) return text({ error: res.reason, candidates: res.candidates.map((c) => c.name) });
      const r = await categoriseTransactions({ supabase, householdId: hid, transactionIds: args.transactionIds, categoryId: res.category.id });
      const hint = r.similarCount > 0
        ? (r.similarMerchant
            ? `${r.similarCount} other uncategorised transactions match — call apply_similar with merchant "${r.similarMerchant}" and category "${res.category.name}" to include them.`
            : `${r.similarCount} other uncategorised transactions match this description pattern — categorise them individually (apply_similar matches on merchant, which this rule lacks).`)
        : undefined;
      return text({ category: res.category.name, ...r, ...(hint ? { hint } : {}) });
    },
  ),

  defineTool(
    "apply_similar",
    "Apply a category to every non-manually-categorised transaction for a merchant. Use after categorise_transactions reports similarCount > 0.",
    { merchant: z.string().min(1), category: z.string().min(1) },
    async (args: { merchant: string; category: string }, extra) => {
      const supabase = createSupabaseServiceClient();
      const hid = householdId(extra);
      const res = await resolveCategory(supabase, hid, args.category);
      if (!res.ok) return text({ error: res.reason, candidates: res.candidates.map((c) => c.name) });
      const r = await applySimilar({ supabase, householdId: hid, merchant: args.merchant, categoryId: res.category.id });
      return text({ category: res.category.name, ...r });
    },
  ),

  defineTool(
    "accept_suggestions",
    "Accept the categorisation engine's pending suggestions (clear needs_review) without changing the category. Pass transactionIds to accept specific ones, or omit to accept all pending.",
    { transactionIds: z.array(z.string()).optional() },
    async (args: { transactionIds?: string[] }, extra) => {
      const supabase = createSupabaseServiceClient();
      const r = await acceptSuggestions({ supabase, householdId: householdId(extra), transactionIds: args.transactionIds });
      return text(r);
    },
  ),
];
