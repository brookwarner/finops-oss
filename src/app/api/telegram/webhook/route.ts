import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { scopedDb } from "@/lib/supabase/scoped";
import { revalidateHousehold } from "@/lib/cache/household";
import { buildAnthropicClient } from "@/lib/categorise/llm";
import { resolveCategory } from "@/lib/categories/resolve";
import { searchTransactions } from "@/lib/transactions/query";
import { checkWebhookAuth } from "@/lib/telegram/auth";
import { interpret } from "@/lib/telegram/interpret";
import { resolveWrite, type ResolveDeps } from "@/lib/telegram/resolve";
import { summariseAction } from "@/lib/telegram/summary";
import { createPending, attachMessageId, consumePending } from "@/lib/telegram/pending";
import { applyAction } from "@/lib/telegram/apply";
import { runReadQuery } from "@/lib/telegram/read";
import { sendMessage, editMessageText, answerCallbackQuery } from "@/lib/telegram/send";

export const dynamic = "force-dynamic";

async function ownerHouseholdId(supabase: ReturnType<typeof createSupabaseServiceClient>): Promise<string> {
  const { data } = await supabase.from("households").select("id").limit(1).single();
  return data!.id as string;
}

export async function POST(request: NextRequest) {
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token") ?? undefined;
  const update = await request.json().catch(() => null);
  if (!update) return NextResponse.json({ ok: true });

  const msg = update.message;
  const cb = update.callback_query;
  const fromId = String(msg?.from?.id ?? cb?.from?.id ?? "");

  const auth = checkWebhookAuth(
    { secretHeader, fromId },
    { secret: env.TELEGRAM_WEBHOOK_SECRET, allowedSenderId: env.TELEGRAM_CHAT_ID },
  );
  if (!auth.ok) return NextResponse.json({ ok: false }, { status: auth.status });

  // Best-effort chat id for the error path (auth has already pinned the sender).
  const errorChatId = String(msg?.chat?.id ?? cb?.message?.chat?.id ?? env.TELEGRAM_CHAT_ID ?? "");

  try {
    return await handleUpdate({ msg, cb });
  } catch (err) {
    // Any throw on the hot path (LLM/DB transient error) must NOT 500 — Telegram
    // retries non-2xx, which would redeliver the same update and re-bill the LLM.
    // Swallow to a 200 and best-effort tell the user.
    console.error("[telegram] handler error", err);
    if (errorChatId) await sendMessage(errorChatId, "Something went wrong handling that — please try again.").catch(() => {});
    return NextResponse.json({ ok: true });
  }
}

async function handleUpdate({ msg, cb }: { msg: any; cb: any }) {
  const supabase = createSupabaseServiceClient();
  const householdId = await ownerHouseholdId(supabase);

  if (cb) {
    const chatId = String(cb.message?.chat?.id ?? env.TELEGRAM_CHAT_ID);
    const messageId = cb.message?.message_id as number | undefined;
    const data = String(cb.data ?? "");
    await answerCallbackQuery(cb.id);
    const [verb, id] = data.split(":");
    if (verb === "x") {
      if (messageId) await editMessageText(chatId, messageId, "✖️ Cancelled.");
      return NextResponse.json({ ok: true });
    }
    if (verb === "c" && id) {
      const action = await consumePending(supabase, id);
      const result = action ? await applyAction(supabase, householdId, action) : "That confirmation expired — send the request again.";
      if (action) revalidateHousehold(householdId); // a confirmed write (budget/categorisation) landed — drop cached reads
      if (messageId) await editMessageText(chatId, messageId, result);
      else await sendMessage(chatId, result);
    }
    return NextResponse.json({ ok: true });
  }

  if (msg?.text) {
    const chatId = String(msg.chat.id);
    const client = buildAnthropicClient();
    if (!client) { await sendMessage(chatId, "AI is not configured."); return NextResponse.json({ ok: true }); }

    const interp = await interpret(msg.text, client);

    if (interp.kind === "clarify") { await sendMessage(chatId, interp.question); return NextResponse.json({ ok: true }); }
    if (interp.kind === "read_query") { await sendMessage(chatId, await runReadQuery(supabase, householdId, interp.query)); return NextResponse.json({ ok: true }); }

    const deps: ResolveDeps = {
      resolveCategory: (name) => resolveCategory(supabase, householdId, name),
      currentTarget: async (categoryId) => {
        const { data } = await scopedDb(supabase, householdId).budgets.select("monthly_target").eq("category_id", categoryId).maybeSingle();
        return data ? Number(data.monthly_target) : null;
      },
      searchTxns: (hint) => searchTransactions({ supabase, householdId, query: hint, limit: 6 }),
      needsReviewIds: async (categoryId) => {
        const { data } = await scopedDb(supabase, householdId).transactions.select("id").eq("category_id", categoryId).eq("needs_review", true);
        return (data ?? []).map((r: { id: string }) => r.id);
      },
    };

    const resolved = await resolveWrite(interp, deps);
    if (!resolved.ok) { await sendMessage(chatId, resolved.question); return NextResponse.json({ ok: true }); }

    const summary = summariseAction(resolved.action);
    const pendingId = await createPending(supabase, { householdId, action: resolved.action, summary, chatId });
    const messageId = await sendMessage(chatId, `${summary}\n\nConfirm?`, { confirmId: pendingId });
    if (messageId) await attachMessageId(supabase, pendingId, messageId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
