import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedRoles = new Set([
  "admin",
  "director",
  "finance_manager",
  "accountant",
  "sales",
  "cashier",
  "hr",
  "auditor",
  "employee",
  "viewer",
]);

const blockedDomains = new Set([
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "yopmail.com",
  "trashmail.com",
]);

function allowedEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const parts = normalized.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes(".")) return false;
  const domain = parts[1];
  return domain === "gmail.com" || !blockedDomains.has(domain);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
  }

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Session requise" }, { status: 401 });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) return Response.json({ error: "Session invalide" }, { status: 401 });

  let body: { organizationId?: string; email?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Requête invalide" }, { status: 400 });
  }

  const organizationId = String(body.organizationId || "");
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "viewer");

  if (!organizationId || !allowedEmail(email) || !allowedRoles.has(role)) {
    return Response.json({ error: "Invitation invalide" }, { status: 400 });
  }

  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError || !membership || !["owner", "admin"].includes(membership.role)) {
    return Response.json({ error: "Permission insuffisante" }, { status: 403 });
  }

  const appUrl = Deno.env.get("APP_URL") || "https://magnisa.vercel.app";
  const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${appUrl}/auth/callback`,
  });

  if (inviteError || !invitation.user) {
    return Response.json({ error: inviteError?.message || "Invitation impossible" }, { status: 400 });
  }

  const { error: memberError } = await admin.from("organization_members").upsert(
    {
      organization_id: organizationId,
      user_id: invitation.user.id,
      role,
      status: "active",
    },
    { onConflict: "organization_id,user_id" }
  );

  if (memberError) return Response.json({ error: memberError.message }, { status: 500 });

  return Response.json({ ok: true, userId: invitation.user.id });
});
