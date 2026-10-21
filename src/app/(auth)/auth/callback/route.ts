import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The email OTP types GoTrue can hand back on a `token_hash` link. Narrowed from
// the raw query param so an arbitrary string never reaches verifyOtp.
const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup", "invite", "magiclink", "recovery", "email_change", "email",
];

function emailOtpType(raw: string | null): EmailOtpType | null {
  return EMAIL_OTP_TYPES.includes(raw as EmailOtpType) ? (raw as EmailOtpType) : null;
}

function safeNext(raw: string | null, base: URL): string | null {
  if (!raw) return null;
  // Resolve against the request origin and only accept the result if it stays
  // same-origin. This defeats tricks like "/\evil.com" or control-char paths
  // that URL resolution would otherwise send off-origin.
  try {
    const resolved = new URL(raw, base);
    if (resolved.origin !== base.origin) return null;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Two shapes of email link land here:
  //  - `?code=`       PKCE, what the browser client's signInWithOtp produces.
  //  - `?token_hash=` the server-verifiable form (Supabase's SSR pattern, and
  //                   what the admin generate_link API returns as hashed_token).
  // Both are single-use and verified by GoTrue; the difference is only where the
  // proof travels. Without the token_hash branch such a link falls back to
  // GoTrue's implicit flow, which returns the session in a URL *fragment* — never
  // sent to the server, so no cookie is set and the visitor bounces to /login.
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = emailOtpType(url.searchParams.get("type"));
  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  } else if (tokenHash && otpType) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
  }
  const next = safeNext(url.searchParams.get("next"), url);
  return NextResponse.redirect(new URL(next ?? "/connect", url));
}
