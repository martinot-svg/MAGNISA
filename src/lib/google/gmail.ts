import { openSecret, sealSecret } from "@/lib/security/secret-box";
import { createAdminClient } from "@/lib/supabase/admin";

type ConnectionRow = {
  id: string;
  email: string;
};

export type GmailHeader = { name?: string; value?: string };
export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};
export type GmailDraft = { id: string; message?: GmailMessage };

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

export async function gmailJson<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 403 && detail.includes("insufficientPermissions")) {
      throw new Error("MAGNISA n'a pas encore l'autorisation complète Gmail. Reconnecte Gmail après avoir ajouté le scope gmail.modify dans Google Auth Platform.");
    }
    throw new Error(`Gmail API (${response.status}) : ${detail.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function gmailHeader(message: GmailMessage, name: string) {
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

export function decodeBase64Url(value?: string) {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function collectBodies(part?: GmailPart, acc: { plain: string[]; html: string[] } = { plain: [], html: [] }) {
  if (!part) return acc;
  const data = decodeBase64Url(part.body?.data);
  if (data && part.mimeType === "text/plain") acc.plain.push(data);
  if (data && part.mimeType === "text/html") acc.html.push(data);
  for (const child of part.parts || []) collectBodies(child, acc);
  return acc;
}

export function gmailBody(message: GmailMessage) {
  const bodies = collectBodies(message.payload);
  if (bodies.plain.length) return { text: bodies.plain.join("\n"), html: bodies.html.join("\n") };
  if (bodies.html.length) return { text: "", html: bodies.html.join("\n") };
  const single = decodeBase64Url(message.payload?.body?.data);
  return message.payload?.mimeType === "text/html"
    ? { text: "", html: single }
    : { text: single, html: "" };
}

export type GmailAttachmentMeta = {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
};

export function gmailAttachments(message: GmailMessage) {
  const result: GmailAttachmentMeta[] = [];
  const walk = (part?: GmailPart) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      result.push({
        filename: part.filename,
        mimeType: part.mimeType || "application/octet-stream",
        attachmentId: part.body.attachmentId,
        size: Number(part.body.size || 0),
      });
    }
    for (const child of part.parts || []) walk(child);
  };
  walk(message.payload);
  return result;
}

export function parseAddressList(value: string) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => {
      const match = part.match(/<([^>]+)>/);
      return (match?.[1] || part).trim().replace(/^"|"$/g, "").toLowerCase();
    })
    .filter((email) => email.includes("@"));
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
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  pdf?: Buffer;
  filename?: string;
  attachments?: Array<{ data: Buffer; filename: string; mimeType?: string }>;
  inReplyTo?: string;
  references?: string;
}) {
  const boundary = `magnisa_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeTo = sanitizeHeader(args.to);
  const safeFrom = sanitizeHeader(args.from);
  const attachments = [...(args.attachments || [])];
  if (args.pdf && args.filename) {
    attachments.push({ data: args.pdf, filename: args.filename, mimeType: "application/pdf" });
  }

  const headers = [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    args.cc ? `Cc: ${sanitizeHeader(args.cc)}` : "",
    args.bcc ? `Bcc: ${sanitizeHeader(args.bcc)}` : "",
    `Subject: ${encodeHeader(sanitizeHeader(args.subject))}`,
    args.inReplyTo ? `In-Reply-To: ${sanitizeHeader(args.inReplyTo)}` : "",
    args.references ? `References: ${sanitizeHeader(args.references)}` : "",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(args.body),
    "",
  ].filter(Boolean);

  for (const attachment of attachments) {
    const safeFilename = sanitizeHeader(attachment.filename).replace(/"/g, "");
    headers.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType || "application/octet-stream"}; name="${safeFilename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${safeFilename}"`,
      "",
      base64Lines(attachment.data),
      "",
    );
  }
  headers.push(`--${boundary}--`, "");
  return Buffer.from(headers.join("\r\n"), "utf8").toString("base64url");
}

export async function sendGmailRaw(accessToken: string, raw: string, threadId?: string) {
  return gmailJson<{ id: string; threadId: string }>(accessToken, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
  });
}

export async function createGmailDraft(accessToken: string, raw: string, threadId?: string) {
  return gmailJson<GmailDraft>(accessToken, "/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }),
  });
}

export async function updateGmailDraft(accessToken: string, draftId: string, raw: string, threadId?: string) {
  return gmailJson<GmailDraft>(accessToken, `/drafts/${encodeURIComponent(draftId)}`, {
    method: "PUT",
    body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }),
  });
}

export async function sendGmailDraft(accessToken: string, draftId: string) {
  return gmailJson<GmailMessage>(accessToken, "/drafts/send", {
    method: "POST",
    body: JSON.stringify({ id: draftId }),
  });
}

export async function deleteGmailDraft(accessToken: string, draftId: string) {
  return gmailJson<void>(accessToken, `/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
}
