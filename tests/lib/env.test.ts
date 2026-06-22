import { describe, it, expect, afterEach } from "vitest";
import { env } from "@/lib/env";

// env.ts exposes getters that read process.env at access time, so we can drive
// behaviour by mutating process.env per case and restoring afterwards.
const SAVED = { ...process.env };

afterEach(() => {
  // Restore the original environment so cases don't leak into each other.
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED)) delete process.env[key];
  }
  Object.assign(process.env, SAVED);
});

describe("required server vars", () => {
  it("returns the value when set", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-key";
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("svc-key");
  });

  it("throws a clear error when unset", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => env.SUPABASE_SERVICE_ROLE_KEY).toThrow(
      "Missing required env var: SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  it("treats an empty string as missing", () => {
    process.env.AKAHU_APP_TOKEN = "";
    expect(() => env.AKAHU_APP_TOKEN).toThrow(
      "Missing required env var: AKAHU_APP_TOKEN",
    );
  });
});

describe("optional server vars", () => {
  it("returns the value when set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    expect(env.TELEGRAM_BOT_TOKEN).toBe("bot-token");
  });

  it("returns undefined (never throws) when unset", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(env.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it("normalises an empty string to undefined", () => {
    process.env.ANTHROPIC_API_KEY = "";
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
