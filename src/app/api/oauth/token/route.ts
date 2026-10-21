import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyAuthCode, verifyPkceS256 } from "@/lib/mcp/pkce";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "@/lib/mcp/jwt";
import { mcpConfig } from "@/lib/mcp/config";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const ACCESS_TTL_SECONDS = 900;

// Issue a fresh access + refresh pair and record the refresh jti for rotation.
async function issueTokens(
  supabase: SupabaseClient,
  identity: { householdId: string; userId: string },
): Promise<NextResponse> {
  const accessToken = await signAccessToken({ ...identity, ttlSeconds: ACCESS_TTL_SECONDS });
  const { token: refreshToken, jti, expiresAt } = await signRefreshToken(identity);
  const { error } = await supabase.from("oauth_refresh_tokens").insert({
    jti,
    household_id: identity.householdId,
    user_id: identity.userId,
    expires_at: expiresAt.toISOString(),
  });
  if (error) return NextResponse.json({ error: "server_error" }, { status: 500 });
  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
  });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const grantType = form.get("grant_type");
  const clientId = String(form.get("client_id") ?? "");

  if (clientId !== mcpConfig().clientId) return NextResponse.json({ error: "invalid_client" }, { status: 401 });

  const supabase = createSupabaseServiceClient();

  if (grantType === "authorization_code") {
    const code = String(form.get("code") ?? "");
    const verifier = String(form.get("code_verifier") ?? "");
    const redirectUri = String(form.get("redirect_uri") ?? "");

    let payload;
    try { payload = await verifyAuthCode(code); }
    catch { return NextResponse.json({ error: "invalid_grant" }, { status: 400 }); }
    if (payload.redirectUri !== redirectUri) return NextResponse.json({ error: "invalid_grant", error_description: "redirect_uri" }, { status: 400 });
    if (!verifyPkceS256(verifier, payload.codeChallenge)) return NextResponse.json({ error: "invalid_grant", error_description: "PKCE" }, { status: 400 });

    const { error: usedErr } = await supabase.from("oauth_used_codes").insert({ jti: payload.jti });
    if (usedErr) return NextResponse.json({ error: "invalid_grant", error_description: "code already used" }, { status: 400 });

    return issueTokens(supabase, { householdId: payload.householdId, userId: payload.userId });
  }

  if (grantType === "refresh_token") {
    const refreshToken = String(form.get("refresh_token") ?? "");
    let claims;
    try { claims = await verifyRefreshToken(refreshToken); }
    catch { return NextResponse.json({ error: "invalid_grant" }, { status: 400 }); }

    // Atomic rotate-on-use: only succeeds if the row exists and is not yet
    // rotated. A second exchange of the same token (replay) updates zero rows.
    const { data: rotated, error: rotErr } = await supabase
      .from("oauth_refresh_tokens")
      .update({ rotated_at: new Date().toISOString() })
      .eq("jti", claims.jti)
      .is("rotated_at", null)
      .select("jti");
    if (rotErr) return NextResponse.json({ error: "server_error" }, { status: 500 });
    if (!rotated || rotated.length === 0) {
      return NextResponse.json({ error: "invalid_grant", error_description: "refresh token revoked or already used" }, { status: 400 });
    }

    return issueTokens(supabase, { householdId: claims.householdId, userId: claims.userId });
  }

  return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
}
