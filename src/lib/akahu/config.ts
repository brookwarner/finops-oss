import { createSupabaseServiceClient } from "@/lib/supabase/service";

export async function getAkahuUserToken(): Promise<string> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("akahu_config")
    .select("user_token")
    .eq("id", true)
    .single();
  if (error || !data?.user_token) {
    throw new Error(
      `akahu_config not seeded: ${error?.message ?? "no row found"}`,
    );
  }
  return data.user_token;
}
