import { openSecret, sealSecret } from "@/lib/security/secret-box";
import { createAdminClient } from "@/lib/supabase/admin";

type ConnectionRow = {
  id: string;
  email: string;
};

function googleClientId() {
  const value = process.env.GOOGLE_CLIENT_ID;
  if (!value) throw new Error("GOOGLE_CLIENT_ID n'est pas configuré.");
  return value;
}

function googleClientSecret() {
  const value = process.env.GOOGLE_CLIENT_SECRET;
  if (!value) throw new Error("GOOGLE_CLIENT_SECRET n'est pas configuré.");
  return value;
}

async function refreshAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Impossible de renouveler l'autorisation Gmail (${response.status}) : ${detail.slice(0, 240)}`);
  }

  return response.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function getGmailAccess(
  organizationId: string,
  userId: string,
): Promise<{ connection: ConnectionRow; accessToken: string }> {
  const admin = createAdminClient();

  const { data: connection, error: connectionError } = await admin
    .from("email_connections")
    .select("id,email")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("provider", "google")
    .eq("status", "active")
    .maybeSingle();

  if (connectionError) throw new Error(connectionError.message);
  if (!connection) throw new Error("Aucun compte Gmail n'est connecté à MAGNISA.");

  const { data: secret, error: secretError } = await admin
    .from("email_connection_secrets")
    .select("refresh_token_ciphertext,access_token_ciphertext,access_token_expires_at")
    .eq("connection_id", connection.id)
    .maybeSingle();

  if (secretError) throw new Error(secretError.message);
  if (!secret?.refresh_token_ciphertext) throw new Error("La connexion Gmail doit être renouvelée.");

  const expiresAt = secret.access_token_expires_at
    ? new Date(secret.access_token_expires_at).getTime()
    : 0;

  if (secret.access_token_ciphertext && expiresAt > Date.now() + 60_000) {
    return {
      connection: connection as ConnectionRow,
      accessToken: openSecret(secret.access_token_ciphertext),
    };
  }

  const refreshed = await refreshAccessToken(openSecret(secret.refresh_token_ciphertext));

  const { error: updateError } = await admin
    .from("email_connection_secrets")
    .update({
      access_token_ciphertext: sealSecret(refreshed.access_token),
      access_token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("connection_id", connection.id);

  if (updateError) throw new Error(updateError.message);

  return {
    connection: connection as ConnectionRow,
    accessToken: refreshed.access_token,
  };
}

function encodeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function base64Lines(value: Buffer | string) {
  const encoded = Buffer.isBuffer(value)
    ? value.toString("base64")
    : Buffer.from(value, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

export function buildMimeMessage(args: {
  from: string;
  to: string;
  subject: string;
  body: string;
  pdf: Buffer;
  filename: string;
}) {
  const boundary = `magnisa_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeTo = sanitizeHeader(args.to);
  const safeFrom = sanitizeHeader(args.from);
  const safeFilename = sanitizeHeader(args.filename).replace(/"/g, "");

  const mime = [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    `Subject: ${encodeHeader(sanitizeHeader(args.subject))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(args.body),
    "",
    `--${boundary}`,
    'Content-Type: application/pdf; name="' + safeFilename + '"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="' + safeFilename + '"',
    "",
    base64Lines(args.pdf),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return Buffer.from(mime, "utf8").toString("base64url");
}

export async function sendGmailRaw(accessToken: string, raw: string) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Envoi Gmail impossible (${response.status}) : ${detail.slice(0, 300)}`);
  }

  return response.json() as Promise<{ id: string; threadId: string }>;
}
