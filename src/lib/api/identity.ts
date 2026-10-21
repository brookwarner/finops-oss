import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authenticateRequest, type ApiIdentity } from "@/lib/api/auth";

/**
 * Resolve a request's identity from EITHER a logged-in cookie session (PWA) OR a
 * PAT/OAuth bearer (CLI/MCP). Cookie wins when present. Returns null when neither
 * authenticates. The returned supabase client is service-role for PAT callers and
 * the user-scoped ssr client for cookie callers — both are safe because every
 * write lib filters by householdId.
 *
 * Cookie branch mirrors requireHouseholdId() in src/lib/auth/household.ts
 * (household_members(user_id, household_id)) but returns null instead of throwing
 * so PAT fallback can run.
 */
export async function resolveIdentity(request: Request): Promise<ApiIdentity | null> {
  const ssr = await createSupabaseServerClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (user) {
    const { data: member } = await ssr
      .from("household_members")
      .select("household_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (member?.household_id) {
      return { supabase: ssr as unknown as SupabaseClient, householdId: member.household_id, userId: user.id };
    }
  }
  return authenticateRequest(request);
}
