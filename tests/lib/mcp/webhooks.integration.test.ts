// Explicitly opt in: uses isolated, disposable households on the configured DB.
import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { subscribe, unsubscribe } from "@/lib/mcp/webhook-subscriptions";
import { dispatchBudgetWebhooks } from "@/lib/mcp/webhook-delivery";
import type { Db } from "@/lib/supabase/scoped";

it.skipIf(process.env.FINOPS_WEBHOOK_INTEGRATION !== "1")("captures, claims, retries, renews and stops isolated durable subscriptions", async () => {
  vi.stubEnv("MCP_JWT_SECRET", "isolated-webhook-verification-key-1234567890");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as Db;
  const checked = async (query: any) => { const r = await query; if (r.error) throw Error(r.error.code + ": " + r.error.message); return r.data; };
  const [member] = await checked(db.from("household_members").select("user_id").limit(1));
  const households: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const [row] = await checked(db.from("households").insert({ name: "Isolated MCP webhook verification" }).select("id"));
      households.push(row.id);
      await checked(db.from("household_members").insert({ household_id: row.id, user_id: member.user_id, role: "owner" }));
    }
    const household = households[0];
    const token = "fops_" + randomBytes(32).toString("base64url");
    await checked(db.from("access_tokens").insert({ household_id: household, user_id: member.user_id,
      name: "Isolated webhook verification", token_hash: createHash("sha256").update(token).digest("hex"), prefix: token.slice(0, 12) }));
    const owner = { householdId: household, userId: member.user_id, token };
    const secret = "whsec_" + randomBytes(32).toString("base64");
    const input = { name: "budget.threshold_crossed" as const, delivery: { mode: "webhook" as const, url: "https://receiver.example/isolated-test", secret } };
    const verify = async (_url: string, body: string, headers: Record<string, string>) => {
      const value: any = new Webhook(secret).verify(body, headers);
      return { status: 200, body: JSON.stringify({ challenge: value.challenge }) };
    };
    const insert = async (hh: string) => {
      const [row] = await checked(db.from("alerts").insert({ household_id: hh, type: "cap_warning", state: "warning",
        title: "Isolated MCP webhook verification", body: "", payload: { target: 100, netSpent: 85, pct: 85 } }).select("id"));
      return row.id;
    };
    await insert(household); // New subscriptions must not receive historical events.
    const registered = await subscribe(db, owner, input, verify);
    const first = await insert(household); await insert(households[1]);
    // Two simultaneous dispatchers must not claim the same subscription.
    const [a, b] = await Promise.all([db.rpc("claim_mcp_event_subscription"), db.rpc("claim_mcp_event_subscription")]);
    expect(a.error).toBeNull(); expect(b.error).toBeNull();
    const claims = [...(a.data ?? []), ...(b.data ?? [])].filter(s => s.id === registered.id);
    expect(claims).toHaveLength(1);
    await checked(db.from("mcp_event_subscriptions").update({ lease_id: null, lease_until: null }).eq("id", registered.id));
    const delivered: string[] = [];
    await dispatchBudgetWebhooks(db, async (_url, body, headers) => {
      const value: any = new Webhook(secret).verify(body, headers); delivered.push(value.eventId);
      return { status: 503, body: "" };
    });
    const [failed] = await checked(db.from("mcp_event_subscriptions").select("*").eq("id", registered.id));
    expect(failed.attempts).toBe(1);
    await subscribe(db, owner, input, verify); // refresh must preserve checkpoint/backoff
    const [renewed] = await checked(db.from("mcp_event_subscriptions").select("*").eq("id", registered.id));
    expect(renewed.last_sequence).toBe(failed.last_sequence); expect(renewed.attempts).toBe(1);
    await checked(db.from("mcp_event_subscriptions").update({ next_attempt_at: new Date(0).toISOString() }).eq("id", registered.id));
    await dispatchBudgetWebhooks(db, async (_url, body, headers) => {
      const value: any = new Webhook(secret).verify(body, headers); delivered.push(value.eventId);
      return { status: 202, body: "" };
    });
    expect(delivered).toEqual([first, first]);
    const [done] = await checked(db.from("mcp_event_subscriptions").select("*").eq("id", registered.id));
    expect(done.delivered_count).toBe(1);
    await unsubscribe(db, owner, input); await unsubscribe(db, owner, input);
    expect(await checked(db.from("mcp_event_subscriptions").select("id").eq("id", registered.id))).toEqual([]);
  } finally {
    for (const household of households) await checked(db.from("households").delete().eq("id", household));
  }
}, 30_000);
