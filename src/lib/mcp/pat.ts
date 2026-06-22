import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export function hashToken(raw: string): string { return createHash("sha256").update(raw).digest("hex"); }

export function generateToken(): { raw: string; prefix: string } {
  const raw = "fops_" + randomBytes(32).toString("base64url");
  return { raw, prefix: raw.slice(0, 12) };
}

export interface PatIdentity { householdId: string; userId: string; }

export async function verifyPat(supabase: SupabaseClient, raw: string): Promise<PatIdentity | null> {
  const hash = hashToken(raw);
  const { data, error } = await supabase
    .from("access_tokens").select("id, household_id, user_id").eq("token_hash", hash).maybeSingle();
  if (error || !data) return null;
  await supabase.from("access_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { householdId: data.household_id, userId: data.user_id };
}
