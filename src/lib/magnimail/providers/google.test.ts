import { describe, expect, it } from "vitest";
import type { GmailMessage } from "@/lib/google/gmail";
import { toMGMailSummary } from "./google";
import { getMailProvider } from "./index";
import { MailProviderError } from "./types";

describe("MGMail — adaptation Gmail", () => {
  const message: GmailMessage = {
    id: "gmail-message-id",
    threadId: "gmail-thread",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Votre facture approche",
    internalDate: "1794650400000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "MITALIA <finance@mitalia.digital>" },
        { name: "To", value: "client@gmail.com" },
        { name: "Subject", value: "Information mensuelle" },
      ],
      parts: [
        {
          mimeType: "application/pdf",
          filename: "facture.pdf",
          body: { attachmentId: "att1", size: 1042 },
        },
      ],
    },
  };

  it("normalise les adresses, dossiers et pièces jointes Gmail", () => {
    const result = toMGMailSummary(message);
    expect(result.id).toBe("gmail-message-id");
    expect(result.from?.email).toBe("finance@mitalia.digital");
    expect(result.to).toEqual([{ email: "client@gmail.com" }]);
    expect(result.folder).toBe("inbox");
    expect(result.unread).toBe(true);
    expect(result.hasAttachments).toBe(true);
    expect(result.subject).toBe("Information mensuelle");
  });

  it("respecte un dossier explicite lors du chargement", () => {
    const result = toMGMailSummary(message, "drafts");
    expect(result.folder).toBe("drafts");
  });

  it("expose uniquement l'adaptateur réellement développé", () => {
    expect(getMailProvider("google").provider).toBe("google");
    expect(() => getMailProvider("microsoft")).toThrow(MailProviderError);
    expect(() => getMailProvider("imap")).toThrow(/pas encore configuré/);
  });
});
