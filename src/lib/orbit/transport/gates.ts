import { normalizePublicEmail, parsePublicRecipients } from "./address";

export type SenderRecord = {
  id: string;
  organization_id: string;
  domain_request_id: string;
  address_request_id: string;
  email_address: string;
  provider: string;
  status: string;
  provider_verified_at: string | null;
  provider_domain_ref: string | null;
};
export type PublicMailReadyFlags = {
  enabled: boolean;
  hasCredentials: boolean;
  domainVerified: boolean;
  addressApproved: boolean;
  recipientAuthorized: boolean;
};

export function validExternalRequestId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function allowPublicSend(
  identity: SenderRecord | null,
  organizationId: string,
  flags: PublicMailReadyFlags,
): boolean {
  return Boolean(identity
    && identity.organization_id === organizationId
    && identity.status === "active"
    && identity.provider === "resend"
    && identity.provider_verified_at
    && identity.provider_domain_ref?.trim()
    && flags.enabled && flags.hasCredentials && flags.domainVerified
    && flags.addressApproved && flags.recipientAuthorized);
}

export function normalizeOutgoingMessage(value: unknown): {
  identityId: string; requestId: string; to: string[]; subject: string; text: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Message professionnel invalide.");
  const d=value as Record<string,unknown>;
  if (!validExternalRequestId(d.identityId) || !validExternalRequestId(d.requestId))
    throw new Error("Identité ou demande d'envoi invalide.");
  const recipients=typeof d.to==="string" ? d.to
    : Array.isArray(d.to) && d.to.every(x=>typeof x==="string")
      ? d.to.join(",") : "";
  const to=parsePublicRecipients(recipients);
  const subject=typeof d.subject==="string"?d.subject.trim():"";
  const text=typeof d.text==="string"?d.text:"";
  if (!subject || subject.length>180 || !text.trim() || text.length>50000)
    throw new Error("Objet ou contenu de message invalide.");
  return {identityId:d.identityId,requestId:d.requestId,to,subject,text};
}

/** An inbound recipient must match an explicitly provisioned, active public identity. */
export function eligiblePublicRecipient(
  sender: Pick<SenderRecord,"email_address"|"provider"|"status"|"provider_verified_at"|"provider_domain_ref"> & {
    receive_enabled: boolean;
  },
  recipient: string,
): boolean {
  return sender.provider==="resend" && sender.status==="active"
    && sender.receive_enabled && !!sender.provider_verified_at
    && !!sender.provider_domain_ref?.trim()
    && normalizePublicEmail(sender.email_address)===normalizePublicEmail(recipient);
}

export function enabledMagniboxInternetMail(environment: NodeJS.ProcessEnv=process.env): boolean {
  // Killswitch: no explicit provider onboarding means zero external side effects.
  return environment.MAGNIBOX_EXTERNAL_MAIL_ENABLED==="true";
}
