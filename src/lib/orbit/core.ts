/**
 * MAGNIBOX Core contracts.
 *
 * Provider-neutral domain vocabulary shared by server services and adapters.
 * These pure contracts do not replace database RLS or server-side authorization.
 */

export type MagniboxMailboxKind = "personal" | "shared" | "service";
export type MagniboxAction = "read" | "send" | "manage";
export type MagniboxMessageDirection = "incoming" | "outgoing" | "internal";
export type MagniboxDeliveryState =
  | "draft"
  | "queued"
  | "sending"
  | "accepted"
  | "delivered"
  | "failed"
  | "bounced"
  | "uncertain"
  | "received";

export type MagniboxMailboxRef = {
  id: string;
  organizationId: string;
  kind: MagniboxMailboxKind;
  active: boolean;
};

export type MagniboxAccessContext = {
  userId: string;
  organizationId: string;
  activeOrganizationMember: boolean;
  /** Explicit per-user grant; owner rights should be resolved by the server adapter. */
  grant?: {
    active: boolean;
    canRead: boolean;
    canSend: boolean;
    canManage: boolean;
  } | null;
};

/**
 * Evaluates the domain-level grant only. Callers must still authenticate,
 * load the mailbox inside the active organization, and enforce database RLS.
 */
export function canUseMagniboxMailbox(
  mailbox: MagniboxMailboxRef,
  context: MagniboxAccessContext,
  action: MagniboxAction,
): boolean {
  if (!mailbox.active
    || !context.activeOrganizationMember
    || mailbox.organizationId !== context.organizationId
    || !context.userId) return false;

  const grant = context.grant;
  if (!grant?.active) return false;

  switch (action) {
    case "read": return grant.canRead;
    case "send": return grant.canSend;
    case "manage": return grant.canManage;
    default: return false;
  }
}

export function isFinalMagniboxDeliveryState(
  state: MagniboxDeliveryState,
): boolean {
  return state === "delivered"
    || state === "failed"
    || state === "bounced"
    || state === "received";
}

/** Provider acceptance is deliberately not treated as final delivery. */
export function isConfirmedMagniboxDelivery(
  state: MagniboxDeliveryState,
): boolean {
  return state === "delivered";
}
