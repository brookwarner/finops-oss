import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { callbackUrl, publicAddress } from "@/lib/mcp/webhook-http";
import { decryptSecret, encryptSecret, signedHeaders, subscribe, subscribeParams, subscriptionId, unsubscribe } from "@/lib/mcp/webhook-subscriptions";
import { dispatchBudgetWebhooks, retryDelay } from "@/lib/mcp/webhook-delivery";
import type { Db } from "@/lib/supabase/scoped";

const household = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000002";
const secret = "whsec_" + randomBytes(32).toString("base64");
const input = { name: "budget.threshold_crossed" as const, delivery: { mode: "webhook" as const, url: "https://receiver.example/callback", secret } };
beforeEach(() => { vi.stubEnv("MCP_JWT_SECRET", "a".repeat(32)); });

function fakeDb() {
  const state = { sub: null as any, events: [] as any[], member: true, credential: true, calls: [] as any[], claimed: false };
  const db = {
    rpc: vi.fn(async (name: string, args: any) => {
      if (name === "save_mcp_event_subscription") {
        state.sub = { last_sequence: 0, attempts: 0, delivered_count: 0, failed_count: 0, ...state.sub, ...args.p };
        return { error: null };
      }
      if (state.claimed || !state.sub) return { data: [], error: null };
      state.claimed = true;
      state.sub.lease_id = "lease";
      return { data: [{ ...state.sub }], error: null };
    }),
    from(table: string) {
      const filters: any[] = []; let op = "select"; let values: any;
      const q: any = {
        select: () => q, order: () => q, limit: () => q,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
        gt: (key: string, value: unknown) => { filters.push([key, value, "gt"]); return q; },
        update: (v: any) => { op = "update"; values = v; return q; },
        delete: () => { op = "delete"; return q; },
        maybeSingle: () => run(true), then: (a: any, b: any) => run(false).then(a, b),
      };
      async function run(single: boolean) {
        state.calls.push({ table, filters: [...filters], op, values });
        let data: any = null;
        if (table === "household_members") data = state.member ? { user_id: user } : null;
        if (table === "access_tokens") data = state.credential ? { id: "pat" } : null;
        if (table === "categories") data = filters.some(([k, v]) => k === "id" && v === "foreign") ? null : { id: "cat" };
        if (table === "mcp_event_subscriptions") {
          if (op === "update") Object.assign(state.sub, values);
          if (op === "delete") state.sub = null;
          data = state.sub;
        }
        if (table === "mcp_events") data = state.events.filter(e => filters.every(([k, v, cmp]) => k === "household_id" || (cmp === "gt" ? e[k] > v : e[k] === v)));
        return { data: single ? data : data, error: null };
      }
      return q;
    },
  } as unknown as Db;
  return { db, state };
}

it("requires a sufficiently sized canonical signing key", () => {
  expect(subscribeParams.safeParse(input).success).toBe(true);
  expect(subscribeParams.safeParse({ ...input, delivery: { ...input.delivery, secret: "whsec_YQ==" } }).success).toBe(false);
});
it("signs exact bytes using Standard Webhooks and encrypts stored secrets", () => {
  const body = JSON.stringify({ hello: "world" }); const time = new Date();
  const headers = signedHeaders("event", "sub", secret, body, time);
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`event.${Math.floor(time.getTime() / 1000)}.${body}`).digest("base64");
  expect(headers["webhook-signature"]).toBe(`v1,${expected}`);
  expect(new Webhook(secret).verify(body, headers)).toEqual({ hello: "world" });
  const encrypted = encryptSecret(secret);
  expect(encrypted).not.toContain(secret); expect(decryptSecret(encrypted)).toBe(secret);
  expect(() => decryptSecret(encrypted.slice(0, -4) + "AAAA")).toThrow();
});
it.each(["127.0.0.1", "10.1.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1", "0.0.0.0"])("blocks non-public callback IP %s", ip => {
  expect(publicAddress(ip)).toBe(false);
});
it("accepts public IPs and refuses callback URL credentials, insecure transport and ports", () => {
  expect(publicAddress("8.8.8.8")).toBe(true); expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  for (const url of ["http://example.com", "https://user:pass@example.com", "https://example.com:444", "https://[::1]/", "https://127.1/"]) expect(() => callbackUrl(url)).toThrow();
});
it("verifies before saving, caches verification, refreshes without resetting progress and isolates owners", async () => {
  const { db, state } = fakeDb(); const owner = { householdId: household, userId: user, token: "fops_test" };
  const post = vi.fn(async (_url: string, body: string, headers: Record<string, string>) => {
    const value: any = new Webhook(secret).verify(body, headers);
    expect(value.type).toBe("verification"); return { status: 200, body: JSON.stringify({ challenge: value.challenge }) };
  });
  const result = await subscribe(db, owner, input, post);
  expect(result.cursor).toBeNull(); expect(result.id).toBe(state.sub.id); expect(state.sub.secret_ciphertext).not.toBe(secret);
  state.sub.last_sequence = 17;
  await subscribe(db, owner, input, post);
  expect(post).toHaveBeenCalledTimes(1); expect(state.sub.last_sequence).toBe(17);
  expect(subscriptionId({ ...owner, userId: "another" }, input.delivery.url)).not.toBe(result.id);
  await unsubscribe(db, owner, input); await unsubscribe(db, owner, input);
  expect(state.sub).toBeNull();
  expect(state.calls.filter(c => c.table === "mcp_event_subscriptions").every(c => c.filters.some(([k,v]: any) => k === "household_id" && v === household))).toBe(true);
});
it("does not activate failed callback challenges", async () => {
  const { db, state } = fakeDb();
  await expect(subscribe(db, { householdId: household, userId: user }, input, async () => ({ status: 200, body: '{"challenge":"wrong"}' }))).rejects.toMatchObject({ code: -32015 });
  expect(state.sub).toBeNull();
});

describe("durable webhook dispatch", () => {
  async function setup() {
    const f = fakeDb();
    await subscribe(f.db, { householdId: household, userId: user, token: "fops_test" }, input,
      async (_url, body) => ({ status: 200, body: JSON.stringify({ challenge: JSON.parse(body).challenge }) }));
    f.state.events = [1, 2].map(sequence => ({ sequence, event_id: `event-${sequence}`, name: input.name, occurred_at: new Date().toISOString(), data: { state: "warning" } }));
    return f;
  }
  it("checkpoints each accepted event and never resends an acknowledged ID after restart", async () => {
    const { db, state } = await setup();
    const post = vi.fn(async (_url: string, body: string, headers: Record<string,string>) => {
      expect((new Webhook(secret).verify(body, headers) as any).eventId).toBe(headers["webhook-id"]);
      return { status: 202, body: "" };
    });
    expect((await dispatchBudgetWebhooks(db, post)).delivered).toBe(2);
    expect(state.sub.last_sequence).toBe(2); expect(state.sub.lease_id).toBeNull();
    state.claimed = false; await dispatchBudgetWebhooks(db, post);
    expect(post).toHaveBeenCalledTimes(2);
  });
  it("retries the same ID after failure without skipping later events", async () => {
    const { db, state } = await setup(); const ids: string[] = [];
    await dispatchBudgetWebhooks(db, async (_url, _body, headers) => { ids.push(headers["webhook-id"]); return { status: 503, body: "" }; });
    expect(state.sub.last_sequence).toBe(0); expect(state.sub.attempts).toBe(1);
    expect(Date.parse(state.sub.next_attempt_at)).toBeGreaterThan(Date.now() + 50_000);
    state.claimed = false;
    await dispatchBudgetWebhooks(db, async (_url, _body, headers) => { ids.push(headers["webhook-id"]); return { status: 200, body: "" }; });
    expect(ids).toEqual(["event-1", "event-1", "event-2"]);
    expect(state.sub.delivered_count).toBe(2);
  });
  it.each([410, 413])("does not retry terminal status %s", async status => {
    const { db, state } = await setup();
    await dispatchBudgetWebhooks(db, async () => ({ status, body: "" }));
    if (status === 410) expect(Date.parse(state.sub.expires_at)).toBeLessThanOrEqual(Date.now());
    else { expect(state.sub.last_sequence).toBe(1); expect(state.sub.failed_count).toBe(1); }
  });
  it("stops deliveries when a PAT is revoked or household access is removed", async () => {
    for (const field of ["member", "credential"] as const) {
      const { db, state } = await setup(); state[field] = false;
      const post = vi.fn(); await dispatchBudgetWebhooks(db, post);
      expect(post).not.toHaveBeenCalled(); expect(state.sub.last_error).toBe("authorization_revoked");
    }
  });
  it("caps exponential backoff", () => { expect(retryDelay(1)).toBe(60_000); expect(retryDelay(8)).toBe(3_600_000); });
});
