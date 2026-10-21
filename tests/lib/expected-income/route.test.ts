import { beforeEach, expect, it, vi } from "vitest";

const { resolve, save, read } = vi.hoisted(() => ({ resolve: vi.fn(), save: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/mcp/auth", () => ({ resolveCredential: resolve }));
vi.mock("@/lib/expected-income/store", async (original) => ({
  ...await original<typeof import("@/lib/expected-income/store")>(), saveSnapshot: save, readSnapshot: read,
}));
import { GET, POST } from "@/app/api/expected-income/route";
import { SnapshotConflict } from "@/lib/expected-income/store";

const snapshot = { schemaVersion: 1, source: "brookos", generatedAt: "2026-10-10T00:00:00Z", payments: [] };
function request(body: unknown = snapshot) {
  return new Request("https://finops.example/api/expected-income", {
    method: "POST", headers: { "Authorization": "Bearer fops_test" }, body: JSON.stringify(body),
  });
}
beforeEach(() => { vi.clearAllMocks(); resolve.mockResolvedValue({ householdId: "household-a", userId: "user-a" });
  save.mockResolvedValue(undefined); read.mockResolvedValue(null); });
it("rejects unauthenticated imports before reading or writing", async () => {
  resolve.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  expect((await GET(request())).status).toBe(401);
  expect(save).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});
it("validates the entire body and rejects household injection before mutation", async () => {
  expect((await POST(request({ ...snapshot, householdId: "household-b" }))).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});
it("binds the imported snapshot to the token's household", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(save).toHaveBeenCalledWith({}, "household-a", snapshot);
});
it("returns a conflict status for stale/concurrent snapshots", async () => {
  save.mockRejectedValue(new SnapshotConflict("stale snapshot"));
  expect((await POST(request())).status).toBe(409);
});
