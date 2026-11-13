/**
 * Provider-neutral contract for MGMail.
 *
 * Adapters translate provider-specific APIs (Gmail, Microsoft Graph, IMAP/SMTP)
 * into these normalized shapes. Tokens and provider secrets must never be
 * exposed to client components.
 */

export type EmailProviderId = "google" | "microsoft" | "imap";

export type EmailFolder =
  | "inbox"
  | "sent"
  | "drafts"
  | "archive"
  | "trash"
  | "spam"
  | "custom";

export type EmailAddress = {
  name?: string;
  email: string;
};

export type EmailAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
};

export type NormalizedEmailMessage = {
  id: string;
  threadId?: string;
  folder: EmailFolder;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress[];
  textBody: string;
  htmlBody?: string;
  preview: string;
  receivedAt: string;
  sentAt?: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  attachments: EmailAttachment[];
  providerData?: Record<string, unknown>;
};

export type EmailMessagePage = {
  messages: NormalizedEmailMessage[];
  nextCursor?: string;
  totalEstimate?: number;
};

export type ListEmailMessagesOptions = {
  folder: EmailFolder;
  query?: string;
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
};

export type ComposeEmailInput = {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    content: Uint8Array;
  }>;
  inReplyTo?: string;
  threadId?: string;
};

export type EmailDraft = {
  id: string;
  message: Partial<NormalizedEmailMessage>;
  updatedAt?: string;
};

export type EmailProviderCapabilities = {
  folders: EmailFolder[];
  search: boolean;
  drafts: boolean;
  attachments: boolean;
  readState: boolean;
  labels: boolean;
  serverSideMove: boolean;
  revokeConnection: boolean;
};

export interface EmailProviderAdapter {
  readonly provider: EmailProviderId;
  readonly capabilities: EmailProviderCapabilities;

  listMessages(options: ListEmailMessagesOptions): Promise<EmailMessagePage>;
  getMessage(messageId: string): Promise<NormalizedEmailMessage>;
  sendMessage(input: ComposeEmailInput): Promise<{ id: string; threadId?: string }>;

  createDraft(input: ComposeEmailInput): Promise<EmailDraft>;
  updateDraft(draftId: string, input: ComposeEmailInput): Promise<EmailDraft>;
  sendDraft(draftId: string): Promise<{ id: string; threadId?: string }>;
  deleteDraft(draftId: string): Promise<void>;

  getAttachment(messageId: string, attachmentId: string): Promise<{
    filename: string;
    mimeType: string;
    content: Uint8Array;
  }>;

  setRead(messageId: string, isRead: boolean): Promise<void>;
  moveMessage(messageId: string, destination: EmailFolder): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  revoke(): Promise<void>;
}
