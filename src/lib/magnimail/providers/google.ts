/**
 * Adaptateur Gmail du contrat commun MGMail.
 *
 * Ne modifie pas les anciennes routes Gmail : l'intégration progressive permet
 * de comparer les réponses et de préserver le parcours existant.
 */
import {
  buildMimeMessage,
  createGmailDraft,
  deleteGmailDraft,
  getGmailAccess,
  gmailAttachments,
  gmailBody,
  gmailHeader,
  gmailJson,
  parseAddressList,
  sendGmailRaw,
  sendGmailDraft,
  updateGmailDraft,
  type GmailDraft,
  type GmailMessage,
} from "@/lib/google/gmail";
import {
  MailProviderError,
  type MailAddress,
  type MailDraftInput,
  type MailFolder,
  type MailMessage,
  type MailMessageSummary,
  type MailProviderAdapter,
  type MailProviderContext,
} from "./types";

const folderLabels: Record<Exclude<MailFolder, "drafts">, string> = {
  inbox: "INBOX",
  sent: "SENT",
  trash: "TRASH",
};

function toAddresses(value: string): MailAddress[] {
  return parseAddressList(value).map((email) => ({ email }));
}

function folderFor(message: GmailMessage, override?: MailFolder): MailFolder {
  if (override) return override;
  if (message.labelIds?.includes("TRASH")) return "trash";
  if (message.labelIds?.includes("SENT")) return "sent";
  if (message.labelIds?.includes("DRAFT")) return "drafts";
  return "inbox";
}

export function toMGMailSummary(message: GmailMessage, folder?: MailFolder): MailMessageSummary {
  const labels = message.labelIds || [];
  const sender = toAddresses(gmailHeader(message, "From"))[0] || null;
  return {
    id: message.id,
    threadId: message.threadId || null,
    folder: folderFor(message, folder),
    subject: gmailHeader(message, "Subject") || "(Sans objet)",
    from: sender,
    to: toAddresses(gmailHeader(message, "To")),
    cc: toAddresses(gmailHeader(message, "Cc")),
    date: gmailHeader(message, "Date") || (message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : null),
    snippet: message.snippet || "",
    unread: labels.includes("UNREAD"),
    hasAttachments: gmailAttachments(message).length > 0,
  };
}

function toMime(connectionEmail: string, message: MailDraftInput) {
  if (!message.to.length) throw new MailProviderError("Destinataire requis.", "UNSUPPORTED");
  return buildMimeMessage({
    from: connectionEmail,
    to: message.to.map((item) => item.email).join(", "),
    cc: message.cc?.map((item) => item.email).join(", "),
    bcc: message.bcc?.map((item) => item.email).join(", "),
    subject: message.subject,
    body: message.textBody,
    inReplyTo: message.replyToMessageId,
    references: message.references,
    attachments: message.attachments?.map((file) => ({
      data: file.content,
      filename: file.filename,
      mimeType: file.mimeType,
    })),
  });
}

async function gmailConnection(context: MailProviderContext) {
  const access = await getGmailAccess(context.organizationId, context.userId);
  if (access.connection.id !== context.connectionId) {
    // Une connexion autorisée pour A ne doit jamais pouvoir accéder à B.
    throw new MailProviderError("Boîte MGMail non autorisée.", "PERMISSION_DENIED");
  }
  return access;
}

export const gmailProvider: MailProviderAdapter = {
  provider: "google",
  capabilities: {
    read: true,
    send: true,
    drafts: true,
    search: true,
    moveToTrash: true,
    restoreFromTrash: true,
    attachments: true,
  },

  async listMessages({ context, folder, query, cursor, limit = 30 }) {
    const { accessToken } = await gmailConnection(context);
    const params = new URLSearchParams({ maxResults: String(Math.max(1, Math.min(limit, 100))) });
    if (query) params.set("q", query);
    if (cursor) params.set("pageToken", cursor);
    if (folder === "drafts") {
      const page = await gmailJson<{ drafts?: GmailDraft[]; nextPageToken?: string; resultSizeEstimate?: number }>(
        accessToken, `/drafts?${params.toString()}`,
      );
      const items = await Promise.all((page.drafts || []).map(async (draft) => {
        const detail = await gmailJson<GmailDraft>(
          accessToken, `/drafts/${encodeURIComponent(draft.id)}?format=full`,
        );
        if (!detail.message) return null;
        return toMGMailSummary(detail.message, "drafts");
      }));
      return {
        items: items.filter((item): item is MailMessageSummary => item !== null),
        nextCursor: page.nextPageToken || null,
        totalEstimate: page.resultSizeEstimate,
      };
    }
    params.append("labelIds", folderLabels[folder]);
    const page = await gmailJson<{
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>(accessToken, `/messages?${params.toString()}`);
    const items = await Promise.all((page.messages || []).map(async (item) =>
      toMGMailSummary(await gmailJson<GmailMessage>(
        accessToken, `/messages/${encodeURIComponent(item.id)}?format=full`,
      ), folder),
    ));
    return {
      items,
      nextCursor: page.nextPageToken || null,
      totalEstimate: page.resultSizeEstimate,
    };
  },

  async getMessage({ context, messageId }): Promise<MailMessage> {
    const { accessToken } = await gmailConnection(context);
    const msg = await gmailJson<GmailMessage>(
      accessToken, `/messages/${encodeURIComponent(messageId)}?format=full`,
    );
    const base = toMGMailSummary(msg);
    const body = gmailBody(msg);
    return {
      ...base,
      bcc: toAddresses(gmailHeader(msg, "Bcc")),
      textBody: body.text,
      htmlBody: body.html,
      messageIdHeader: gmailHeader(msg, "Message-ID") || null,
      references: gmailHeader(msg, "References") || null,
      attachments: gmailAttachments(msg).map((att) => ({
        id: att.attachmentId,
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
      })),
    };
  },

  async sendMessage({ context, message }) {
    const { accessToken, connection } = await gmailConnection(context);
    const raw = toMime(connection.email, message);
    const result = message.draftId
      ? await (async () => {
          await updateGmailDraft(accessToken, message.draftId!, raw, message.threadId);
          return sendGmailDraft(accessToken, message.draftId!);
        })()
      : await sendGmailRaw(accessToken, raw, message.threadId);
    return { messageId: result.id, threadId: result.threadId || null };
  },

  async saveDraft({ context, message, draftId }) {
    const { accessToken, connection } = await gmailConnection(context);
    const raw = toMime(connection.email, message);
    const draft = draftId
      ? await updateGmailDraft(accessToken, draftId, raw, message.threadId)
      : await createGmailDraft(accessToken, raw, message.threadId);
    return { draftId: draft.id, messageId: draft.message?.id || null };
  },

  async deleteDraft({ context, draftId }) {
    const { accessToken } = await gmailConnection(context);
    await deleteGmailDraft(accessToken, draftId);
  },

  async moveMessage({ context, messageId, destination }) {
    const { accessToken } = await gmailConnection(context);
    const operation = destination === "trash" ? "trash" : "untrash";
    await gmailJson<void>(accessToken, `/messages/${encodeURIComponent(messageId)}/${operation}`, {
      method: "POST",
      body: "{}",
    });
  },

  async getAttachment({ context, messageId, attachmentId }) {
    const { accessToken } = await gmailConnection(context);
    const message = await gmailJson<GmailMessage>(
      accessToken, `/messages/${encodeURIComponent(messageId)}?format=full`,
    );
    const attachment = gmailAttachments(message).find((item) => item.attachmentId === attachmentId);
    if (!attachment) throw new MailProviderError("Pièce jointe introuvable.", "NOT_FOUND");
    const payload = await gmailJson<{ data?: string }>(
      accessToken,
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    if (!payload.data) throw new MailProviderError("Pièce jointe vide ou indisponible.", "NOT_FOUND");
    return {
      content: Buffer.from(payload.data, "base64url"),
      mimeType: attachment.mimeType,
      filename: attachment.filename,
    };
  },
};
