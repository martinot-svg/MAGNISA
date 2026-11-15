/** Public Internet email is routed by the MAGNIBOX-owned SMTP infrastructure. */
export type OutgoingInternetMessage = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  /** A request UUID persisted atomically before SMTP submission. */
  requestId: string;
};
export type InternetAccepted = {
  provider: "smtp";
  providerMessageId: string;
  /** SMTP queue acceptance is NOT a final remote delivery confirmation. */
  state: "accepted";
};
export type IncomingInternetMessage = {
  from: string;
  to: string[];
  subject: string;
  text: string;
};
export interface InternetTransport {
  readonly provider: InternetAccepted["provider"];
  send(message: OutgoingInternetMessage): Promise<InternetAccepted>;
}
