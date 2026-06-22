import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedAction } from "./types";

const TTL_MS = 5 * 60 * 1000;

export async function createPending(supabase: SupabaseClient, args: {
  householdId: string; action: ResolvedAction; summary: string; chatId: string;
}): Promise<string> {
  const expires = new Date(Date.now() + TTL_MS).toISOString();
  const { data, error } = await supabase.from("telegram_pending_actions")
    .insert({ household_id: args.householdId, action: args.action, summary: args.summary, chat_id: args.chatId, expires_at: expires })
    .select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function attachMessageId(supabase: SupabaseClient, id: string, messageId: number): Promise<void> {
  await supabase.from("telegram_pending_actions").update({ message_id: messageId }).eq("id", id);
}

/** Atomically claim a pending action: single-use + unexpired. Null if already used/expired. */
export async function consumePending(supabase: SupabaseClient, id: string): Promise<ResolvedAction | null> {
  const { data, error } = await supabase.from("telegram_pending_actions")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id).is("consumed_at", null).gt("expires_at", new Date().toISOString())
    .select("action").maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.action as ResolvedAction) ?? null;
}
