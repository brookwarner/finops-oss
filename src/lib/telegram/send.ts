import { env } from "@/lib/env";

const API = (method: string) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

export async function sendMessage(chatId: string, text: string, opts?: { confirmId?: string }): Promise<number | null> {
  const reply_markup = opts?.confirmId
    ? { inline_keyboard: [[
        { text: "✅ Confirm", callback_data: `c:${opts.confirmId}` },
        { text: "✖️ Cancel", callback_data: `x:${opts.confirmId}` },
      ]] }
    : undefined;
  const res = await fetch(API("sendMessage"), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", reply_markup }),
  });
  const json = await res.json().catch(() => ({}));
  return json?.result?.message_id ?? null;
}

export async function editMessageText(chatId: string, messageId: number, text: string): Promise<void> {
  await fetch(API("editMessageText"), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "Markdown" }),
  }).catch(() => {});
}

export async function answerCallbackQuery(id: string): Promise<void> {
  await fetch(API("answerCallbackQuery"), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: id }),
  }).catch(() => {});
}
