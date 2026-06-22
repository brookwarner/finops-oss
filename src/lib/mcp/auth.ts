import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyAccessToken } from "./jwt";
import { verifyPat, type PatIdentity } from "./pat";

export async function resolveCredential(authHeader: string | undefined, supabase: SupabaseClient): Promise<PatIdentity | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  if (token.startsWith("fops_")) return verifyPat(supabase, token);
  try {
    const c = await verifyAccessToken(token);
    return { householdId: c.householdId, userId: c.userId };
  } catch {
    return verifyPat(supabase, token);
  }
}
