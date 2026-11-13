import { recipientEmails, type ComposePayload } from "@/lib/magnimail/compose";
import type { MailDraftInput } from "./types";

/**
 * Translates the existing MAGNISA compose form to the shared MGMail contract.
 * Keeps reply threading, drafts, CC/BCC and attachment bytes intact.
 */
export function composeForMailProvider(compose: ComposePayload): MailDraftInput {
  return {
    to: recipientEmails(compose.to).map((email) => ({ email })),
    cc: recipientEmails(compose.cc).map((email) => ({ email })),
    bcc: recipientEmails(compose.bcc).map((email) => ({ email })),
    subject: compose.subject,
    textBody: compose.body,
    threadId: compose.threadId,
    draftId: compose.draftId,
    replyToMessageId: compose.inReplyTo,
    references: compose.references,
    attachments: compose.attachments.map((file) => ({
      filename: file.filename,
      mimeType: file.mimeType,
      content: file.data,
    })),
  };
}
