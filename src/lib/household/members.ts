import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type HouseholdMember = {
  userId: string;
  email: string | null;
  role: string;
  joinedAt: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim + lowercase an invite email. Throws on empty / invalid.
 *  Lowercasing matters: the allowlist trigger compares lower(email). */
export function normaliseInviteEmail(raw: string): string {
  const email = (raw ?? "").trim().toLowerCase();
  if (!email) throw new Error("Email is required");
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address");
  return email;
}

/** Allowlisted emails that aren't yet members (case-insensitive). */
export function computePendingInvites(
  allowlistEmails: string[],
  memberEmails: (string | null)[],
): string[] {
  const members = new Set(
    memberEmails.filter((e): e is string => !!e).map((e) => e.toLowerCase()),
  );
  return allowlistEmails
    .map((e) => e.toLowerCase())
    .filter((e) => !members.has(e));
}

/** List all members of a household with emails. Service-role: required because
 *  household_members RLS only returns the caller's own row and emails live in
 *  auth.users. Server-only. */
export async function listHouseholdMembers(householdId: string): Promise<HouseholdMember[]> {
  const svc = createSupabaseServiceClient();
  const { data: rows, error } = await svc
    .from("household_members")
    .select("user_id, role, created_at")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  // Safe assumption: this app runs a single shared household (migration 0033 consolidates all
  // users into one household), so total auth users ≈ household size — well under 1000; no
  // pagination needed.
  const { data: usersData, error: usersErr } = await svc.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) throw new Error(usersErr.message);
  const emailById = new Map(usersData.users.map((u) => [u.id, u.email ?? null]));

  return (rows ?? []).map((m) => ({
    userId: m.user_id,
    email: emailById.get(m.user_id) ?? null,
    role: m.role,
    joinedAt: m.created_at,
  }));
}

/** All allowlisted signup emails. Service-role: signup_allowlist is deny-all
 *  under RLS. Server-only. */
export async function listAllowlistEmails(): Promise<string[]> {
  const svc = createSupabaseServiceClient();
  // Global (unscoped) read is correct by design: signup_allowlist (migration 0005) is a global
  // signup gate with no household_id column — it must be checked before a household even exists,
  // and this app runs a single shared household.
  const { data, error } = await svc.from("signup_allowlist").select("email");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.email!);
}
