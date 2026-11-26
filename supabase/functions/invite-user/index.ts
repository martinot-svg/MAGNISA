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

const disposableHints = [
  "mailinator",
  "tempmail",
  "10minutemail",
  "guerrillamail",
  "yopmail",
  "trashmail",
  "dispostable",
];

function allowedEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const parts = normalized.split("@");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !parts[1] ||
    parts[0].length > 64 ||
    normalized.length > 254 ||
    /\s/.test(normalized)
  ) return false;

  const domain = parts[1];
  const labels = domain.split(".");
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
  ) return false;

  return !disposableHints.some((hint) => domain.includes(hint));
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

  // Existing accounts receive an in-app invitation. New accounts receive the
  // Supabase Auth invitation email. In both cases, membership stays pending
  // until the invited user explicitly accepts it from their personal space.
  const { data: existingProfile, error: profileLookupError } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (profileLookupError) {
    return Response.json({ error: "Vérification du compte destinataire impossible" }, { status: 500 });
  }

  let invitedUserId: string;
  let invitationEmailSent = false;

  if (existingProfile?.id) {
    const { data: existingMembership, error: existingMembershipError } = await admin
      .from("organization_members")
      .select("status")
      .eq("organization_id", organizationId)
      .eq("user_id", existingProfile.id)
      .maybeSingle();

    if (existingMembershipError) {
      return Response.json({ error: "Vérification de l'adhésion impossible" }, { status: 500 });
    }
    if (existingMembership?.status === "active") {
      return Response.json({ error: "Ce compte appartient déjà à cette organisation" }, { status: 409 });
    }
    if (existingMembership?.status === "suspended") {
      return Response.json({ error: "L'accès de ce compte est suspendu" }, { status: 409 });
    }

    invitedUserId = existingProfile.id;
  } else {
    const appUrl = Deno.env.get("APP_URL") || "https://magnisa.vercel.app";
    const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl}/auth/callback?next=/reset-password`,
    });

    if (inviteError || !invitation.user) {
      return Response.json({ error: inviteError?.message || "Invitation impossible" }, { status: 400 });
    }

    invitedUserId = invitation.user.id;
    invitationEmailSent = true;
  }

  const { error: memberError } = await admin.from("organization_members").upsert(
    {
      organization_id: organizationId,
      user_id: invitedUserId,
      role,
      status: "invited",
    },
    { onConflict: "organization_id,user_id" }
  );

  if (memberError) return Response.json({ error: "Impossible d'enregistrer l'invitation" }, { status: 500 });

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  if (organizationError || !organization) {
    return Response.json({ error: "Organisation introuvable après création de l'invitation" }, { status: 500 });
  }

  const { error: notificationError } = await admin.from("notifications").upsert(
    {
      organization_id: organizationId,
      recipient_user_id: invitedUserId,
      category: "system",
      priority: "info",
      title: "Invitation à rejoindre une équipe",
      body: `Vous êtes invité(e) à rejoindre ${organization.name} sur MAGNISA. Consultez votre espace personnel pour accepter ou refuser cette invitation.`,
      action_url: "/espace-personnel#invitations",
      entity_type: "organization_invitation",
      entity_id: organizationId,
      metadata: { role },
      dedupe_key: `organization-invitation:${organizationId}:${invitedUserId}`,
      read_at: null,
      archived_at: null,
    },
    { onConflict: "organization_id,recipient_user_id,dedupe_key" }
  );

  if (notificationError) {
    return Response.json({ error: "Invitation créée, mais notification interne indisponible" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    userId: invitedUserId,
    emailSent: invitationEmailSent,
    existingAccount: Boolean(existingProfile?.id),
  });
});