// Centralised, validated access to server-side environment variables.
//
// Why this exists (review finding P3): `process.env.*` reads with `?? ""`
// fallbacks were scattered across ~9 server modules, so a missing secret
// surfaced late as a generic downstream error (a 500 from Supabase, an empty
// Akahu token, etc.) instead of an obvious "this var is unset" message. This
// module is the single place that reads and validates them.
//
// Required vs optional:
//   - REQUIRED secrets throw a clear `Missing required env var: X` the first
//     time they are accessed (i.e. at request/boot time for a serverless
//     function), rather than silently defaulting to "".
//   - OPTIONAL vars (Telegram, MCP overrides, home-refresh overrides) are
//     exposed as `string | undefined` and never throw — callers already treat
//     their absence as "feature disabled / use default".
//
// IMPORTANT — NEXT_PUBLIC_* inlining: Next.js only inlines `NEXT_PUBLIC_*` at
// build time when they appear as the literal `process.env.NEXT_PUBLIC_X`.
// Routing the public vars through a runtime accessor here would break the
// browser bundle, so client-reachable code (e.g. `supabase/browser.ts`,
// `middleware.ts`) MUST keep reading `process.env.NEXT_PUBLIC_*` directly. The
// public accessors below are for SERVER-only use, where runtime reads are fine.
//
// Validation is intentionally lazy (per-accessor) rather than at module load so
// that `next build` — which imports these modules without real secrets — does
// not fail. Each accessor still fails fast and loudly the first time a missing
// required var is actually needed.

/** Read a required server var, throwing a clear error if unset/empty. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/** Read an optional server var; empty string is normalised to undefined. */
function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Typed, validated server environment. Each property is a getter so validation
 * runs at access time (fail-fast on first use) without breaking the build.
 */
export const env = {
  // --- Supabase ---------------------------------------------------------
  /** Public Supabase URL. Server-side reads only — see NEXT_PUBLIC note above. */
  get NEXT_PUBLIC_SUPABASE_URL(): string {
    return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  },
  /** Public anon key. Server-side reads only — see NEXT_PUBLIC note above. */
  get NEXT_PUBLIC_SUPABASE_ANON_KEY(): string {
    return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  /** Service-role key — bypasses RLS, server-only, required. */
  get SUPABASE_SERVICE_ROLE_KEY(): string {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },

  // --- Akahu ------------------------------------------------------------
  get AKAHU_APP_TOKEN(): string {
    return requireEnv("AKAHU_APP_TOKEN");
  },
  get AKAHU_APP_SECRET(): string {
    return requireEnv("AKAHU_APP_SECRET");
  },

  // --- Anthropic (LLM categorisation fallback) --------------------------
  // Optional: categorisation degrades gracefully (LLM step is skipped) when
  // the key is absent, so the client builder returns null rather than throwing.
  get ANTHROPIC_API_KEY(): string | undefined {
    return optionalEnv("ANTHROPIC_API_KEY");
  },

  // --- MCP --------------------------------------------------------------
  // All optional: the config has sensible localhost/dev defaults baked into
  // the consumer (`mcpConfig`), so absence is not fatal.
  get MCP_PUBLIC_URL(): string | undefined {
    return optionalEnv("MCP_PUBLIC_URL");
  },
  get MCP_OAUTH_CLIENT_ID(): string | undefined {
    return optionalEnv("MCP_OAUTH_CLIENT_ID");
  },
  get MCP_OAUTH_CLIENT_SECRET(): string | undefined {
    return optionalEnv("MCP_OAUTH_CLIENT_SECRET");
  },
  get MCP_JWT_SECRET(): string | undefined {
    return optionalEnv("MCP_JWT_SECRET");
  },

  // --- Telegram ---------------------------------------------------------
  // Optional by design: the Telegram sender no-ops (returns { ok: false,
  // error: "telegram not configured" }) when these are absent.
  get TELEGRAM_BOT_TOKEN(): string | undefined {
    return optionalEnv("TELEGRAM_BOT_TOKEN");
  },
  get TELEGRAM_CHAT_ID(): string | undefined {
    return optionalEnv("TELEGRAM_CHAT_ID");
  },
  get TELEGRAM_WEBHOOK_SECRET(): string | undefined {
    return optionalEnv("TELEGRAM_WEBHOOK_SECRET");
  },

  // --- Home-value refresh cron overrides --------------------------------
  // Optional overrides; the cron route falls back to baked-in defaults.
  get HOME_PROPERTY_ID(): string | undefined {
    return optionalEnv("HOME_PROPERTY_ID");
  },
  get HOME_ACCOUNT_KEY(): string | undefined {
    return optionalEnv("HOME_ACCOUNT_KEY");
  },
} as const;
