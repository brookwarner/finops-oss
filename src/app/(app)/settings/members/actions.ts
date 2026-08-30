"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { normaliseInviteEmail, listHouseholdMembers } from "@/lib/household/members";

/** Throw unless the cookie-session caller is the household owner. Returns the
 *  household id. Service-role bypasses RLS, so this gate is enforced in code. */
async function requireOwnerHousehold(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthenticated");
  const { data, error } = await supabase
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", user.id)
    .single();
  if (error || !data) throw new Error("No household for user");
  if (data.role !== "owner") {
    throw new Error("Only the household owner can manage members");
  }
  return data.household_id;
}

/** Add an email to the signup allowlist so that person can sign in and auto-join
 *  the household. No-op if already present. */
export async function inviteMember(emailRaw: string): Promise<void> {
  await requireOwnerHousehold();
  const email = normaliseInviteEmail(emailRaw);
  const svc = createSupabaseServiceClient();
  const { error } = await svc
    .from("signup_allowlist")
    .upsert(
      { email, note: "invited via members page" },
      { onConflict: "email", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
  revalidatePath("/settings/members");
}

/** Remove a pending invite. Refuses to remove the allowlist row of someone who
 *  has already joined (they're a real member, not a pending invite). */
export async function revokeInvite(emailRaw: string): Promise<void> {
  const householdId = await requireOwnerHousehold();
  const email = normaliseInviteEmail(emailRaw);
  const members = await listHouseholdMembers(householdId);
  const isMember = members.some((m) => (m.email ?? "").toLowerCase() === email);
  if (isMember) {
    throw new Error("That person has already joined and can't be un-invited");
  }
  const svc = createSupabaseServiceClient();
  const { error } = await svc.from("signup_allowlist").delete().eq("email", email);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/members");
}
