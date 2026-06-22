"use server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { generateToken, hashToken } from "@/lib/mcp/pat";
import { revalidatePath } from "next/cache";

export async function mintToken(name: string): Promise<{ raw: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthenticated");
  const householdId = await requireHouseholdId();
  const { raw, prefix } = generateToken();
  const { error } = await supabase.from("access_tokens").insert({
    household_id: householdId, user_id: user.id, name: name || "MCP token", token_hash: hashToken(raw), prefix,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/settings/tokens");
  return { raw };
}

export async function revokeToken(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("access_tokens").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings/tokens");
}
