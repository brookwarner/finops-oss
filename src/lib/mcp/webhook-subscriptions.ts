import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ProtocolError } from "@modelcontextprotocol/server";
import { Webhook } from "standardwebhooks";
import { z } from "zod";
import { mcpConfig } from "./config";
import { callbackUrl, webhookPost } from "./webhook-http";
import { scopedDb, type Db } from "@/lib/supabase/scoped";
import { eventArguments, EVENT_NAME } from "./event-contract";

const destination = z.object({ mode: z.literal("webhook"), url: z.string().url().max(4096) });
export const subscribeParams = z.object({
  name: z.literal("budget.threshold_crossed"), arguments: eventArguments.default({}),
  delivery: destination.extend({ secret: z.string().max(128).regex(/^whsec_[A-Za-z0-9+/]+={0,2}$/).refine(s => {
    const key = Buffer.from(s.slice(6), "base64");
    return key.length >= 24 && key.length <= 64 && key.toString("base64").replace(/=+$/, "") === s.slice(6).replace(/=+$/, "");
  }, "Signing key must decode to 24-64 bytes") }),
  cursor: z.null().optional(), // Webhook delivery starts now; poll replay remains separate.
});
export const unsubscribeParams = z.object({
  name: z.literal("budget.threshold_crossed"), arguments: eventArguments.default({}), delivery: destination,
});
export interface Principal { householdId: string; userId: string; token?: string; }

export function subscriptionId(owner: Principal, url: string, categoryId?: string): string {
  return "sub_" + createHash("sha256").update(JSON.stringify([
    owner.householdId, owner.userId, url, "budget.threshold_crossed", categoryId ?? null,
  ])).digest("hex");
}
function encryptionKey() {
  const key = mcpConfig().jwtSecret();
  if (key.length < 32) throw new Error("MCP_JWT_SECRET must have at least 32 bytes for webhook secret encryption");
  return createHash("sha256").update("finops-mcp-webhook-secrets-v1\0").update(key).digest();
}
export function encryptSecret(secret: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
}
export function decryptSecret(value: string): string {
  const data = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}
export function signedHeaders(id: string, subscription: string, secret: string, body: string, now = new Date()) {
  return { "webhook-id": id, "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
    "webhook-signature": new Webhook(secret).sign(id, now, body), "X-MCP-Subscription-Id": subscription };
}

export async function subscribe(db: Db, owner: Principal, raw: z.input<typeof subscribeParams>, post = webhookPost) {
  const input = subscribeParams.parse(raw);
  let url: string;
  try { url = callbackUrl(input.delivery.url).href; }
  catch { throw new ProtocolError(-32015, "Callback URL rejected", { reason: "invalid_url" }); }
  const categoryId = input.arguments.categoryId;
  if (categoryId) {
    const { data, error } = await scopedDb(db, owner.householdId).categories.select("id").eq("id", categoryId).maybeSingle();
    if (error) throw new Error("Event filter lookup failed");
    if (!data) throw new ProtocolError(-32602, "Unknown category for this household");
  }
  const id = subscriptionId(owner, url, categoryId);
  const table = scopedDb(db, owner.householdId).mcp_event_subscriptions;
  const { data: prior, error } = await table.select("verified_until, secret_ciphertext").eq("id", id).eq("user_id", owner.userId).maybeSingle();
  if (error) throw new Error("Subscription lookup failed");
  // Cache only for this principal, destination AND signing key.
  const verified = prior && Date.parse(prior.verified_until) > Date.now() && decryptSecret(prior.secret_ciphertext) === input.delivery.secret;
  const verifiedUntil = verified ? prior.verified_until : new Date(Date.now() + 3_600_000).toISOString();
  if (!verified) {
    const challenge = randomBytes(32).toString("base64url");
    const body = JSON.stringify({ type: "verification", challenge });
    try {
      const response = await post(url, body, signedHeaders("msg_verification_" + randomUUID(), id, input.delivery.secret, body));
      const echo = JSON.parse(response.body).challenge;
      if (response.status < 200 || response.status >= 300 || typeof echo !== "string" ||
          Buffer.byteLength(echo) !== Buffer.byteLength(challenge) || !timingSafeEqual(Buffer.from(echo), Buffer.from(challenge))) {
        throw new Error("challenge_failed");
      }
    } catch (error) {
      const reason = error instanceof Error && /timeout|abort/i.test(error.name) ? "timeout" : "challenge_failed";
      throw new ProtocolError(-32015, "Callback verification failed", { reason });
    }
  }
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const { error: saveError } = await db.rpc("save_mcp_event_subscription", { p: {
    id, household_id: owner.householdId, user_id: owner.userId,
    token_hash: owner.token?.startsWith("fops_") ? createHash("sha256").update(owner.token).digest("hex") : null,
    name: EVENT_NAME, category_id: categoryId ?? null, callback_url: url,
    secret_ciphertext: encryptSecret(input.delivery.secret), verified_until: verifiedUntil, expires_at: expires,
  } });
  if (saveError) throw new Error("Subscription save failed");
  return { id, refreshBefore: expires, cursor: null, truncated: false };
}

export async function unsubscribe(db: Db, owner: Principal, raw: z.input<typeof unsubscribeParams>) {
  const input = unsubscribeParams.parse(raw);
  const id = subscriptionId(owner, callbackUrl(input.delivery.url).href, input.arguments.categoryId);
  const { error } = await scopedDb(db, owner.householdId).mcp_event_subscriptions.delete().eq("id", id).eq("user_id", owner.userId);
  if (error) throw new Error("Subscription removal failed");
  return {};
}
