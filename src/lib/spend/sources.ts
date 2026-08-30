// src/lib/spend/sources.ts
//
// Read/write the per-category spend classification (categories.spend_class,
// migration 0043) and the category's display group. Used by the
// /settings/classification editor; the *reads* that act on the classification live
// in the cashflow game-plan (bare-essentials floor + discretionary cut lever) and
// the forecast walk.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { orderGroups } from "@/lib/budgets/groups";
import { SPEND_CLASSES, normaliseSpendClass, type SpendClass } from "./classify";

/**
 * The category kinds that represent spending, and so carry a meaningful
 * essential/discretionary classification.
 *
 * `reserve` belongs here: a sinking fund is real spend, just lumpy, and the
 * forecast already reads `spend_class` off reserve budgets alongside
 * `ap_amortised` ones (see `loadCommittedBudgets` in src/lib/forecast/loaders.ts).
 * Single source of truth for both the list and the write guard below, so the
 * editor can never show a category it isn't allowed to save.
 */
export const SPENDABLE_KINDS = ["monthly_cap", "ap_amortised", "reserve"] as const;
export type SpendableKind = (typeof SPENDABLE_KINDS)[number];

export interface SpendSource {
  id: string;
  name: string;
  group: string | null;
  kind: SpendableKind;
  spendClass: SpendClass;
}

/** Every spendable category for the household, with its classification
 *  (NULL ⇒ 'essential'), ordered by group then name for a stable settings list. */
export async function listSpendSources(
  supabase: SupabaseClient,
  householdId: string,
): Promise<SpendSource[]> {
  const db = scopedDb(supabase, householdId);
  const { data, error } = await db.categories
    .select("id, name, group, kind, spend_class")
    .in("kind", SPENDABLE_KINDS as unknown as string[])
    .order("group", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c: any) => ({
    id: c.id as string,
    name: c.name as string,
    group: (c.group as string | null) ?? null,
    kind: c.kind as SpendableKind,
    spendClass: normaliseSpendClass(c.spend_class as string | null),
  }));
}

/**
 * The groups a spend category can be filed under: the ones the household already
 * uses, deduped and in canonical display order. Deliberately not the full
 * GROUP_ORDER list — offering groups nothing is filed under is noise, and the
 * editor's "New group…" escape hatch covers coining one. Pure: derived from rows
 * already loaded, so it costs no extra query.
 */
export function listSpendGroups(sources: Pick<SpendSource, "group">[]): string[] {
  const used = sources.map((s) => s.group).filter((g): g is string => !!g);
  return orderGroups(used);
}

export type SetSpendClassResult = { ok: true } | { ok: false; reason: string };

/** Set a spend category's classification. Scoped to the household and to the
 *  spendable kinds so only spend categories are ever touched. */
export async function setSpendClass(args: {
  supabase: SupabaseClient;
  householdId: string;
  categoryId: string;
  spendClass: SpendClass;
}): Promise<SetSpendClassResult> {
  if (!SPEND_CLASSES.includes(args.spendClass)) return { ok: false, reason: "invalid-class" };
  const db = scopedDb(args.supabase, args.householdId);
  const { data, error } = await db.categories
    .update({ spend_class: args.spendClass })
    .eq("id", args.categoryId)
    .in("kind", SPENDABLE_KINDS as unknown as string[])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: "not-found" };
  return { ok: true };
}

export type SetCategoryGroupResult = { ok: true; group: string | null } | { ok: false; reason: string };

/** Longest group name we'll accept — groups are headings, not descriptions. */
export const MAX_GROUP_LENGTH = 40;

/**
 * Normalise a group name typed by a user: trim, collapse inner whitespace, and
 * treat empty as "no group". Pure, so the same rule applies on every surface.
 */
export function normaliseGroup(raw: string | null | undefined): string | null {
  const g = (raw ?? "").trim().replace(/\s+/g, " ");
  return g === "" ? null : g;
}

/** File a spend category under a group (or clear it with null/""). Scoped to the
 *  household and to the spendable kinds, same guard as setSpendClass. */
export async function setCategoryGroup(args: {
  supabase: SupabaseClient;
  householdId: string;
  categoryId: string;
  group: string | null;
}): Promise<SetCategoryGroupResult> {
  const group = normaliseGroup(args.group);
  if (group && group.length > MAX_GROUP_LENGTH) return { ok: false, reason: "group-too-long" };
  const db = scopedDb(args.supabase, args.householdId);
  const { data, error } = await db.categories
    .update({ group })
    .eq("id", args.categoryId)
    .in("kind", SPENDABLE_KINDS as unknown as string[])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: "not-found" };
  return { ok: true, group };
}
