import { beforeEach, expect, it, vi } from "vitest";
import { snapshotSchema } from "@/lib/expected-income/contract";

const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedDb: scope }));
import { loadExpectedIncome, saveSnapshot, SnapshotConflict } from "@/lib/expected-income/store";

const snapshot = snapshotSchema.parse({ schemaVersion: 1, source: "brookos",
  generatedAt: "2026-10-10T00:00:00Z", payments: [] });
const client = {} as any;

function table(old: any, result: any = { data: { source: "brookos" }, error: null }) {
  const filters: unknown[] = [];
  const mutation = { eq: vi.fn((...args) => { filters.push(args); return mutation; }),
    select: vi.fn(() => mutation), maybeSingle: vi.fn(async () => result), single: vi.fn(async () => result) };
  const read = { eq: vi.fn(() => read), maybeSingle: vi.fn(async () => ({ data: old, error: null })) };
  const t = { select: vi.fn(() => read), insert: vi.fn(() => mutation), update: vi.fn(() => mutation) };
  scope.mockReturnValue({ expected_income_snapshots: t });
  return { t, filters };
}

beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it("inserts one atomic complete source snapshot scoped to the authenticated household", async () => {
  const { t } = table(null);
  await saveSnapshot(client, "household-a", snapshot);
  expect(scope).toHaveBeenCalledWith(client, "household-a");
  expect(t.insert).toHaveBeenCalledWith(expect.objectContaining({ payload: snapshot }));
});
it("retries an identical snapshot without writing again", async () => {
  const { t } = table({ source_updated_at: snapshot.generatedAt, payload: snapshot });
  await saveSnapshot(client, "household-a", snapshot);
  expect(t.insert).not.toHaveBeenCalled(); expect(t.update).not.toHaveBeenCalled();
});
it("rejects stale snapshots and timestamp reuse with changed data", async () => {
  table({ source_updated_at: "2026-10-11T00:00:00Z" });
  await expect(saveSnapshot(client, "a", snapshot)).rejects.toBeInstanceOf(SnapshotConflict);
  table({ source_updated_at: snapshot.generatedAt, payload: { ...snapshot, payments: [{
    id: "x", label: "x", amount: 1, currency: "NZD", expectedDate: "2026-10-20", status: "committed" }] } });
  await expect(saveSnapshot(client, "a", snapshot)).rejects.toBeInstanceOf(SnapshotConflict);
});
it("rejects a concurrent update without overwriting another writer", async () => {
  const { filters } = table({ source_updated_at: "2026-10-09T00:00:00Z" }, { data: null, error: null });
  await expect(saveSnapshot(client, "a", snapshot)).rejects.toBeInstanceOf(SnapshotConflict);
  expect(filters).toContainEqual(["source_updated_at", "2026-10-09T00:00:00Z"]);
});
it("does not read the new table before the rollout gate is enabled", async () => {
  vi.stubEnv("EXPECTED_INCOME_ENABLED", "false");
  expect(await loadExpectedIncome(client, "a")).toEqual([]);
  expect(scope).not.toHaveBeenCalled();
});

it("refuses to double count imported payments against a recurring consulting category", async () => {
  vi.stubEnv("EXPECTED_INCOME_ENABLED", "true");
  const live = snapshotSchema.parse({ ...snapshot, payments: [{ id: "client-1", label: "Client",
    amount: 5000, currency: "NZD", expectedDate: "2026-10-20", status: "committed" }] });
  const result = { eq: vi.fn(() => result), maybeSingle: vi.fn(async () => ({ data: { income_type: "recurring" }, error: null })) };
  const { t } = table({ payload: live, synced_at: "2026-10-10T00:00:00Z" });
  scope.mockReturnValue({ expected_income_snapshots: t, categories: { select: () => result } });
  await expect(loadExpectedIncome(client, "a")).rejects.toThrow("Classify Business Income");
  result.maybeSingle.mockResolvedValue({ data: { income_type: "irregular" }, error: null });
  expect(await loadExpectedIncome(client, "a")).toHaveLength(1);
});
