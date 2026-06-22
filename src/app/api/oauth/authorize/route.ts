import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { isAllowedRedirectUri } from "@/lib/mcp/redirect";
import { signAuthCode } from "@/lib/mcp/pkce";
import { mcpConfig } from "@/lib/mcp/config";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const clientId = sp.get("client_id");
  const redirectUri = sp.get("redirect_uri") ?? "";
  const state = sp.get("state") ?? "";
  const challenge = sp.get("code_challenge");
  const method = sp.get("code_challenge_method");

  if (clientId !== mcpConfig().clientId) return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  if (!isAllowedRedirectUri(redirectUri)) return NextResponse.json({ error: "invalid_request", error_description: "redirect_uri" }, { status: 400 });
  if (!challenge || method !== "S256") return NextResponse.json({ error: "invalid_request", error_description: "PKCE S256 required" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL("/login", req.nextUrl.origin);
    login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  const householdId = await requireHouseholdId();

  const code = await signAuthCode({ userId: user.id, householdId, codeChallenge: challenge, redirectUri });
  const back = new URL(redirectUri);
  back.searchParams.set("code", code);
  if (state) back.searchParams.set("state", state);
  return NextResponse.redirect(back);
}
