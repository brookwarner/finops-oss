import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "@/lib/supabase/scoped";
import { decodeCursor, encodeCursor, pollBudgetEvents, EVENT_NAME } from "@/lib/mcp/events";

const household = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const category = "33333333-3333-4333-8333-333333333333";
const now = Date.parse("2026-10-19T00:00:00Z");
type Row = { sequence: number; household_id: string; category_id: string; event_id: string; name: string; occurred_at: string; data: object };
const rows: Row[] = [];
let fail = false;
function fakeDb() {
  return { from: () => {
    let filters: ((row: Row) => boolean)[] = [];
    let ascending = true;
    let limit = Infinity;
    const query = {
      select: () => query,
      eq: (key: keyof Row, value: unknown) => { filters.push(row => row[key] === value); return query; },
      gt: (key: keyof Row, value: number) => { filters.push(row => Number(row[key]) > value); return query; },
      lte: (key: keyof Row, value: number) => { filters.push(row => Number(row[key]) <= value); return query; },
      gte: (key: keyof Row, value: string) => { filters.push(row => String(row[key]) >= value); return query; },
      order: (_key: string, options: { ascending: boolean }) => { ascending = options.ascending; return query; },
      limit: (value: number) => { limit = value; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
        data: rows.filter(row => filters.every(filter => filter(row)))
          .sort((a, b) => ascending ? a.sequence - b.sequence : b.sequence - a.sequence).slice(0, limit),
        error: fail ? { message: "private database details" } : null,
      })),
    };
    return query;
  } } as unknown as Db;
}
const db = fakeDb();
function event(sequence: number, hid = household, age = 0): Row {
  return { sequence, household_id: hid, category_id: category, event_id: `event-${sequence}`,
    name: EVENT_NAME, occurred_at: new Date(now - age).toISOString(), data: { state: "over" } };
}
const cursor = (sequence = 0, time = now) => encodeCursor({ v: 1, household, category: null, sequence, time });

describe("durable event polling", () => {
  beforeEach(() => { rows.length = 0; fail = false; });
  it("bootstraps from now, then returns newly persisted events", async () => {
    rows.push(event(1), event(2, other));
    const start = await pollBudgetEvents(db, household, { name: EVENT_NAME }, now);
    expect(start.events).toEqual([]);
    expect(decodeCursor(start.cursor, household, null).sequence).toBe(1);
    rows.push(event(3));
    const next = await pollBudgetEvents(db, household, { name: EVENT_NAME, cursor: start.cursor }, now);
    expect(next.events.map(e => e.eventId)).toEqual(["event-3"]);
    expect((await pollBudgetEvents(db, household, { name: EVENT_NAME, cursor: next.cursor }, now)).events).toEqual([]);
  });
  it("paginates without skipping events and replays the same cursor deterministically", async () => {
    rows.push(event(1), event(2), event(3));
    const input = { name: EVENT_NAME as typeof EVENT_NAME, cursor: cursor(), maxEvents: 2 };
    const page = await pollBudgetEvents(db, household, input, now);
    expect(page.hasMore).toBe(true);
    expect(page.events).toHaveLength(2);
    expect(await pollBudgetEvents(db, household, input, now)).toEqual(page);
    const last = await pollBudgetEvents(db, household, { ...input, cursor: page.cursor }, now);
    expect(last.events.map(e => e.eventId)).toEqual(["event-3"]);
    expect(last.hasMore).toBe(false);
  });
  it("isolates households and binds cursors to the household and category filter", async () => {
    rows.push(event(1, other), event(2));
    expect((await pollBudgetEvents(db, household, { name: EVENT_NAME, cursor: cursor() }, now)).events).toHaveLength(1);
    expect(() => decodeCursor(cursor(), other, null)).toThrow("Invalid event cursor");
    await expect(pollBudgetEvents(db, household, {
      name: EVENT_NAME, cursor: cursor(), arguments: { categoryId: category },
    }, now)).rejects.toThrow("Invalid event cursor");
    await expect(pollBudgetEvents(db, "", { name: EVENT_NAME }, now)).rejects.toThrow("Authenticated household");
  });
  it("reports truncated replay and skips expired events", async () => {
    rows.push(event(1, household, 100_000), event(2));
    const page = await pollBudgetEvents(db, household, {
      name: EVENT_NAME, cursor: cursor(0, now - 100_000), maxAgeMs: 60_000,
    }, now);
    expect(page.truncated).toBe(true);
    expect(page.events.map(e => e.eventId)).toEqual(["event-2"]);
  });
  it("fails closed on database errors and rejects malformed or future cursors", async () => {
    fail = true;
    await expect(pollBudgetEvents(db, household, { name: EVENT_NAME }, now)).rejects.toThrow("Event feed unavailable");
    fail = false;
    await expect(pollBudgetEvents(db, household, { name: EVENT_NAME, cursor: "garbage" }, now)).rejects.toThrow("Invalid event cursor");
    await expect(pollBudgetEvents(db, household, { name: EVENT_NAME, cursor: cursor(100) }, now)).rejects.toThrow("ahead");
  });
});

vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => fakeDb() }));
vi.mock("@/lib/mcp/auth", () => ({ resolveCredential: async (header: string) =>
  header === "Bearer test" ? { householdId: household, userId: other } : null }));

describe("MCP HTTP protocol migration", () => {
  async function rpc(method: string, params = {}, version = "2026-07-28", authorized = true) {
    const { POST } = await import("@/app/api/mcp/route");
    const response = await POST(new Request("http://localhost/api/mcp", {
      method: "POST", headers: {
        "Content-Type": "application/json", Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": version, "Mcp-Method": method,
        ...(method === "tools/call" ? { "Mcp-Name": "ping" } : {}),
        ...(authorized ? { Authorization: "Bearer test" } : {}),
      }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {
        ...params, ...(version === "2026-07-28" ? { _meta: { "io.modelcontextprotocol/protocolVersion": version,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "finops-test", version: "1" } } } : {}),
      } }),
    }));
    const body = await response.text();
    const json = body.startsWith("event:") || body.startsWith("data:")
      ? JSON.parse(body.split("\n").find(line => line.startsWith("data:"))!.slice(5))
      : body ? JSON.parse(body) : null;
    return { response, json };
  }
  it("requires authentication", async () => {
    const { response } = await rpc("events/list", {}, "2026-07-28", false);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource");
  });
  it("discovers the new protocol, tools and experimental catalog", async () => {
    const discovery = await rpc("server/discover");
    expect(discovery.json.error).toBeUndefined();
    expect(discovery.json.result.capabilities.events).toEqual({});
    const tools = await rpc("tools/list");
    expect(tools.json.result.tools.some((t: { name: string }) => t.name === "get_finops_events")).toBe(true);
    const catalog = await rpc("events/list");
    expect(catalog.json.result.events[0]).toMatchObject({ name: EVENT_NAME, delivery: ["webhook", "poll"] });
  });
  it("preserves verified household context for tools in both protocol generations", async () => {
    for (const version of ["2026-07-28", "2025-11-25"]) {
      const { json } = await rpc("tools/call", { name: "ping", arguments: {} }, version);
      expect(json.error).toBeUndefined();
      expect(json.result.content[0].text).toBe(`ok household=${household}`);
    }
  });
  it("serves authenticated protocol-level polling", async () => {
    rows.length = 0;
    const { json } = await rpc("events/poll", { name: EVENT_NAME, cursor: null });
    expect(json.error).toBeUndefined();
    expect(json.result.events).toEqual([]);
    expect(typeof json.result.cursor).toBe("string");
  });
});
