import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  const next = safeNext(url.searchParams.get("next"), url);
  return NextResponse.redirect(new URL(next ?? "/connect", url));
}
