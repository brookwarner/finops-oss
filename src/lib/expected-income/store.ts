import type { SupabaseClient } from "@supabase/supabase-js";
import { projectsForward } from "@/lib/income/classify";
import { scopedDb } from "@/lib/supabase/scoped";
import { snapshotSchema, snapshotInflows, type IncomeSnapshot } from "./contract";

export class SnapshotConflict extends Error {}

export async function readSnapshot(supabase: SupabaseClient, householdId: string) {
  const { data, error } = await scopedDb(supabase, householdId).expected_income_snapshots
    .select("payload, source_updated_at, synced_at").eq("source", "brookos").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { snapshot: snapshotSchema.parse(data.payload), syncedAt: data.synced_at as string } : null;
}

// One row per source: replacement is atomic, so cancellations/removals cannot
// leave half of an old snapshot behind. Optimistic concurrency rejects stale
// requests and overlapping writers rather than resurrecting settled income.
export async function saveSnapshot(supabase: SupabaseClient, householdId: string, snapshot: IncomeSnapshot) {
  const table = scopedDb(supabase, householdId).expected_income_snapshots;
  const { data: old, error: readError } = await table.select("source_updated_at, payload")
    .eq("source", snapshot.source).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (old && Date.parse(old.source_updated_at) > Date.parse(snapshot.generatedAt)) {
    throw new SnapshotConflict("stale snapshot; export current BrookOS state and retry");
  }
  if (old && Date.parse(old.source_updated_at) === Date.parse(snapshot.generatedAt)) {
    if (JSON.stringify(snapshotSchema.parse(old.payload)) !== JSON.stringify(snapshot)) {
      throw new SnapshotConflict("snapshot timestamp reused with different contents");
    }
    return;
  }
  const values = { source: snapshot.source, payload: snapshot,
    source_updated_at: snapshot.generatedAt, synced_at: new Date().toISOString() };
  const result = old
    ? await table.update(values).eq("source", snapshot.source)
      .eq("source_updated_at", old.source_updated_at).select("source").maybeSingle()
    : await table.insert(values).select("source").single();
  if (result.error?.code === "23505" || (!result.error && !result.data)) {
    throw new SnapshotConflict("concurrent sync; retry with current BrookOS state");
  }
  if (result.error) throw new Error(result.error.message);
}

export async function loadExpectedIncome(supabase: SupabaseClient, householdId: string) {
  // Rollout gate: deploy/apply the migration before enabling reads. An enabled
  // connector never silently turns a storage failure into zero expected income.
  if (process.env.EXPECTED_INCOME_ENABLED !== "true") return [];
  const row = await readSnapshot(supabase, householdId);
  if (!row) return [];
  const inflows = snapshotInflows(row.snapshot);
  if (inflows.length) {
    // Imported payments must replace assumed consulting recurrence, otherwise
    // inferred historic receipts / an income budget could count the same work.
    const name = process.env.EXPECTED_INCOME_CATEGORY || "Business Income";
    const { data: category, error } = await scopedDb(supabase, householdId).categories
      .select("income_type").eq("name", name).eq("kind", "income").maybeSingle();
    if (error) throw new Error(error.message);
    if (!category || projectsForward(category.income_type)) {
      throw new Error(`Classify ${name} as irregular or one-off before enabling expected income`);
    }
  }
  return inflows;
}
