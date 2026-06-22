import { describe, it, expect, vi } from "vitest";
import { sendTelegram } from "@/lib/alerts/telegram";

const cfg = { token: "BOT123", chatId: "456" };

describe("sendTelegram", () => {
  it("posts to the bot sendMessage endpoint with chat id, text, and Markdown", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const res = await sendTelegram("hello", { ...cfg, fetch });

    expect(res.ok).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botBOT123/sendMessage");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ chat_id: "456", text: "hello", parse_mode: "Markdown" });
  });

  it("returns not-configured (and never calls fetch) when env is missing", async () => {
    const fetch = vi.fn();
    const res = await sendTelegram("hi", { token: "", chatId: "", fetch });
    expect(res).toEqual({ ok: false, error: "telegram not configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces a Telegram API error without throwing", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, json: async () => ({ description: "bad chat" }) });
    const res = await sendTelegram("hi", { ...cfg, fetch });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("bad chat");
  });

  it("never throws on a network failure", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const res = await sendTelegram("hi", { ...cfg, fetch });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNRESET");
  });
});
