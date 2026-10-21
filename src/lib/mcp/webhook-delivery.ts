import { scopedDb, type Db } from "@/lib/supabase/scoped";
import type { Database } from "@/lib/supabase/database.types";
import { decryptSecret, signedHeaders } from "./webhook-subscriptions";
import { webhookPost } from "./webhook-http";

type Subscription = Database["public"]["Tables"]["mcp_event_subscriptions"]["Row"];
export function retryDelay(attempt: number) { return Math.min(3_600_000, 60_000 * 2 ** (attempt - 1)); }

/** A lease fences overlapping cron invocations. A crash may replay an accepted ID. */
export async function dispatchBudgetWebhooks(db: Db, post = webhookPost, budgetMs = 40_000) {
  const end = Date.now() + budgetMs;
  const summary = { delivered: 0, retried: 0, failed: 0, stopped: 0 };
  while (Date.now() < end) {
    // scoped-db-exempt: service-only RPC atomically claims one due subscription across households.
    const { data, error } = await db.rpc("claim_mcp_event_subscription");
    if (error) throw new Error("Webhook claim failed");
    const sub = data?.[0] as Subscription | undefined;
    if (!sub) break;
    const scoped = scopedDb(db, sub.household_id);
    let nextAttempt = new Date(Date.now() + 60_000).toISOString();
    const update = async (values: Database["public"]["Tables"]["mcp_event_subscriptions"]["Update"]) => {
      if (values.next_attempt_at) nextAttempt = values.next_attempt_at;
      const { error } = await scoped.mcp_event_subscriptions.update(values).eq("id", sub.id).eq("lease_id", sub.lease_id);
      if (error) throw new Error("Webhook checkpoint failed");
    };
    try {
      const member = await db.from("household_members").select("user_id")
        .eq("household_id", sub.household_id).eq("user_id", sub.user_id).maybeSingle();
      if (member.error) throw new Error("Subscription authorization lookup failed");
      let authorized = Boolean(member.data);
      if (sub.token_hash) {
        const token = await db.from("access_tokens").select("id").eq("token_hash", sub.token_hash)
          .eq("household_id", sub.household_id).eq("user_id", sub.user_id).maybeSingle();
        if (token.error) throw new Error("Subscription credential lookup failed");
        authorized = authorized && Boolean(token.data);
      }
      if (!authorized) {
        await update({ expires_at: new Date().toISOString(), last_error: "authorization_revoked" });
        summary.stopped++;
        continue;
      }
      let query = scoped.mcp_events.select("sequence, event_id, name, occurred_at, data")
        .gt("sequence", sub.last_sequence).order("sequence", { ascending: true }).limit(10);
      if (sub.category_id) query = query.eq("category_id", sub.category_id);
      const { data: events, error: eventError } = await query;
      if (eventError) throw new Error("Webhook event lookup failed");
      for (const event of events ?? []) {
        if (Date.now() >= end) break;
        // Check unsubscribe/expiration before each network request.
        const live = await scoped.mcp_event_subscriptions.select("id").eq("id", sub.id).eq("lease_id", sub.lease_id)
          .gt("expires_at", new Date().toISOString()).maybeSingle();
        if (live.error) throw new Error("Subscription status lookup failed");
        if (!live.data) break;
        const body = JSON.stringify({ eventId: event.event_id, name: event.name, timestamp: event.occurred_at, data: event.data, cursor: null });
        let status = 0;
        try {
          if (Buffer.byteLength(body) > 262_144) status = 413;
          else status = (await post(sub.callback_url, body, signedHeaders(event.event_id, sub.id, decryptSecret(sub.secret_ciphertext), body))).status;
        } catch { /* Transport failures retry without logging destinations or secrets. */ }
        if (status >= 200 && status < 300) {
          sub.last_sequence = event.sequence;
          sub.delivered_count++;
          sub.attempts = 0;
          await update({ last_sequence: sub.last_sequence, delivered_count: sub.delivered_count, attempts: 0, last_status: status, last_error: null });
          summary.delivered++;
        } else if (status === 410) {
          await update({ expires_at: new Date().toISOString(), last_status: status, last_error: "callback_gone" });
          summary.stopped++;
          break;
        } else {
          const attempts = sub.attempts + 1;
          const exhausted = status === 413 || attempts >= 8;
          await update({ attempts: exhausted ? 0 : attempts, last_status: status,
            last_error: exhausted ? "delivery_exhausted" : "delivery_retry",
            ...(exhausted ? { last_sequence: event.sequence, failed_count: sub.failed_count + 1 } : {}),
            next_attempt_at: new Date(Date.now() + retryDelay(attempts)).toISOString() });
          if (exhausted) { summary.failed++; console.error("[mcp-events] delivery exhausted", sub.id, event.event_id, status); }
          else summary.retried++;
          break;
        }
      }
    } catch {
      await update({ last_error: "dispatcher_error", next_attempt_at: new Date(Date.now() + 60_000).toISOString() });
      summary.retried++;
    } finally {
      // Schedule idle subscriptions once per minute, preserving future backoff.
      const { error } = await scoped.mcp_event_subscriptions.update({ lease_id: null, lease_until: null, next_attempt_at: nextAttempt })
        .eq("id", sub.id).eq("lease_id", sub.lease_id);
      if (error) throw new Error("Webhook lease release failed");
    }
  }
  return summary;
}
