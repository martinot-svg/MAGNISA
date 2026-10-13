import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { buildGoogleAuthorizationUrl } from "@/lib/google/oauth";

const adminRoles = new Set(["owner", "admin"]);

export async function GET() {
  const { role } = await requireOrganization();
  if (!adminRoles.has(role)) {
    return NextResponse.redirect(new URL("/dashboard?access=denied", process.env.NEXT_PUBLIC_APP_URL!));
  }

  const state = randomBytes(32).toString("hex");
  const response = NextResponse.redirect(buildGoogleAuthorizationUrl(state));

  response.cookies.set("magnisa_google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/google/callback",
    maxAge: 10 * 60,
  });

  return response;
}
