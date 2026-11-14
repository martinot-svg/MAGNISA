/** No provider owns the MGMail internal mailbox or the organization's identity. */
export type OutgoingInternetMessage = {
  /** An already provisioned and authorized public sender; never a .mgmail address. */
  from: string;
  to: string[];
  subject: string;
  text: string;
  /** A request UUID persisted atomically before invoking this adapter. */
  requestId: string;
};
export type InternetAccepted = {
  provider: "resend" | "smtp" | "microsoft" | "other";
  providerMessageId: string;
  /** API acceptance is NOT an SMTP delivery confirmation. */
  state: "accepted";
};
export type IncomingInternetMessage = {
  from: string; to: string[]; subject: string; text: string;
};
export interface InternetTransport {
  readonly provider: InternetAccepted["provider"];
  /** Requires verified sender/domain/permissions in calling server service. */
  send(message: OutgoingInternetMessage): Promise<InternetAccepted>;
}
export function internetTransportReady(input: {
  domainOwnershipVerified: boolean;
  sendingProviderVerified: boolean;
  senderActivated: boolean;
  hasProviderCredentials: boolean;
}): boolean {
  return input.domainOwnershipVerified
    && input.sendingProviderVerified
    && input.senderActivated
    && input.hasProviderCredentials;
}
