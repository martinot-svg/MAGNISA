/**
 * Contrat commun des fournisseurs de messagerie MGMail.
 *
 * Les routes HTTP et l'interface ne doivent dépendre ni de Gmail ni de Microsoft Graph.
 * Chaque adaptateur traduit les identifiants et les capacités propres au fournisseur
 * vers ces structures normalisées. Les secrets restent exclusivement côté serveur.
 */

export type MailProviderId = "google" | "microsoft" | "imap";

export type MailFolder = "inbox" | "sent" | "drafts" | "trash";

export type MailAddress = {
  name?: string;
  email: string;
};

export type MailAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type MailMessageSummary = {
  id: string;
  threadId: string | null;
  folder: MailFolder;
  subject: string;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  date: string | null;
  snippet: string;
  unread: boolean;
  hasAttachments: boolean;
};

export type MailMessage = MailMessageSummary & {
  bcc: MailAddress[];
  textBody: string;
  htmlBody: string;
  messageIdHeader: string | null;
  references: string | null;
  attachments: MailAttachment[];
};

export type MailDraftInput = {
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  replyToMessageId?: string;
  references?: string;
  threadId?: string;
  draftId?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    content: Buffer;
  }>;
};

export type MailPage = {
  items: MailMessageSummary[];
  nextCursor: string | null;
  totalEstimate?: number;
};

export type MailProviderCapabilities = {
  read: boolean;
  send: boolean;
  drafts: boolean;
  search: boolean;
  moveToTrash: boolean;
  restoreFromTrash: boolean;
  attachments: boolean;
};

export type MailProviderContext = {
  organizationId: string;
  userId: string;
  connectionId: string;
};

export interface MailProviderAdapter {
  readonly provider: MailProviderId;
  readonly capabilities: MailProviderCapabilities;

  listMessages(input: {
    context: MailProviderContext;
    folder: MailFolder;
    query?: string;
    cursor?: string;
    limit?: number;
  }): Promise<MailPage>;

  getMessage(input: {
    context: MailProviderContext;
    messageId: string;
  }): Promise<MailMessage>;

  sendMessage(input: {
    context: MailProviderContext;
    message: MailDraftInput;
  }): Promise<{ messageId: string; threadId: string | null }>;

  saveDraft(input: {
    context: MailProviderContext;
    message: MailDraftInput;
    draftId?: string;
  }): Promise<{ draftId: string; messageId: string | null }>;

  deleteDraft(input: {
    context: MailProviderContext;
    draftId: string;
  }): Promise<void>;

  moveMessage(input: {
    context: MailProviderContext;
    messageId: string;
    destination: "trash" | "inbox";
  }): Promise<void>;

  getAttachment(input: {
    context: MailProviderContext;
    messageId: string;
    attachmentId: string;
  }): Promise<{ content: Buffer; mimeType: string; filename: string }>;
}

/**
 * Erreur métier stable à convertir en réponse HTTP sans exposer les secrets
 * ou les réponses brutes des fournisseurs.
 */
export class MailProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_CONNECTED"
      | "AUTH_REQUIRED"
      | "PERMISSION_DENIED"
      | "NOT_FOUND"
      | "RATE_LIMITED"
      | "UNSUPPORTED"
      | "UPSTREAM_ERROR",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "MailProviderError";
  }
}
