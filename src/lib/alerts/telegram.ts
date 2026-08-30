// Telegram delivery. Thin wrapper over the Bot API sendMessage endpoint.
// Never throws — callers record { ok, error } against the alert row so a
// delivery failure degrades gracefully (alert still persisted, just undelivered).

import { env } from "@/lib/env";

export interface TelegramConfig {
  token: string;
  chatId: string;
  fetch?: typeof globalThis.fetch;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export function telegramConfigFromEnv(): TelegramConfig {
  return {
    token: env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: env.TELEGRAM_CHAT_ID ?? "",
  };
}

export async function sendTelegram(text: string, cfg: TelegramConfig): Promise<SendResult> {
  const { token, chatId } = cfg;
  if (!token || !chatId) return { ok: false, error: "telegram not configured" };

  const doFetch = cfg.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      return { ok: false, error: (detail as { description?: string }).description ?? `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    if (controller.signal.aborted) return { ok: false, error: "timeout" };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
