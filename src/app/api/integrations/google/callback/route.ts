import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeGoogleCode, getGoogleUserInfo, GOOGLE_GMAIL_SCOPES } from "@/lib/google/oauth";
import { sealSecret } from "@/lib/security/secret-box";

const adminRoles = new Set(["owner", "admin"]);

function settingsUrl(status: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL!;
  return new URL(`/parametres?gmail=${encodeURIComponent(status)}`, base);
}

export async function GET(request: NextRequest) {
  const responseFor = (status: string) => {
    const response = NextResponse.redirect(settingsUrl(status));
    response.cookies.set("magnisa_google_oauth_state", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations/google/callback",
      maxAge: 0,
    });
    return response;
  };

  try {
    const { organizationId, user, role } = await requireOrganization();
    if (!adminRoles.has(role)) return responseFor("access_denied");

    const url = new URL(request.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError) return responseFor("cancelled");

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = request.cookies.get("magnisa_google_oauth_state")?.value;

    if (!code || !state || !expectedState || state !== expectedState) {
      return responseFor("invalid_state");
    }

    const tokens = await exchangeGoogleCode(code);
    const googleUser = await getGoogleUserInfo(tokens.access_token);
    const admin = createAdminClient();
    const now = new Date().toISOString();

    const { data: connection, error: connectionError } = await admin
      .from("email_connections")
      .upsert({
        organization_id: organizationId,
        user_id: user.id,
        provider: "google",
        email: googleUser.email,
        status: "active",
        scopes: (tokens.scope || GOOGLE_GMAIL_SCOPES.join(" ")).split(" ").filter(Boolean),
        connected_at: now,
        updated_at: now,
      }, { onConflict: "organization_id,user_id,provider" })
      .select("id")
      .single();

    if (connectionError || !connection) throw connectionError || new Error("Connexion Gmail introuvable.");

    const { data: previousSecret } = await admin
      .from("email_connection_secrets")
      .select("refresh_token_ciphertext")
      .eq("connection_id", connection.id)
      .maybeSingle();

    const refreshCiphertext = tokens.refresh_token
      ? sealSecret(tokens.refresh_token)
      : previousSecret?.refresh_token_ciphertext;

    if (!refreshCiphertext) {
      throw new Error("Google n'a pas fourni de refresh token. Reconnecte le compte avec consentement.");
    }

    const { error: secretError } = await admin
      .from("email_connection_secrets")
      .upsert({
        connection_id: connection.id,
        refresh_token_ciphertext: refreshCiphertext,
        access_token_ciphertext: sealSecret(tokens.access_token),
        access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: now,
      }, { onConflict: "connection_id" });

    if (secretError) throw secretError;

    return responseFor("connected");
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return responseFor("error");
  }
}
