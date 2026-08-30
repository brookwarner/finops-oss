// Pure webhook auth: constant-time secret-token compare + sender allowlist.

export interface WebhookAuthConfig {
  secret: string | undefined;        // env.TELEGRAM_WEBHOOK_SECRET
  allowedSenderId: string | undefined; // env.TELEGRAM_CHAT_ID
}

export type AuthResult = { ok: true } | { ok: false; status: 401 | 200 };

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Secret mismatch → 401 (someone hitting the URL). Valid secret but wrong/unknown
 * sender → 200 ignore (don't leak that the secret was right). Unconfigured → 401.
 */
export function checkWebhookAuth(
  req: { secretHeader: string | undefined; fromId: string | undefined },
  cfg: WebhookAuthConfig,
): AuthResult {
  if (!cfg.secret || !cfg.allowedSenderId) return { ok: false, status: 401 };
  if (!req.secretHeader || !constantTimeEqual(req.secretHeader, cfg.secret)) return { ok: false, status: 401 };
  if (req.fromId !== cfg.allowedSenderId) return { ok: false, status: 200 };
  return { ok: true };
}
