import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireHouseholdId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthenticated");
  const { data, error } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .single();
  if (error || !data) throw new Error("No household for user");
  return data.household_id;
}
