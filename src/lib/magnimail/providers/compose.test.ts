import { describe, expect, it } from "vitest";
import { composeForMailProvider } from "./compose";
import type { ComposePayload } from "@/lib/magnimail/compose";

const payload: ComposePayload = {
  to: "client@exemple.com",
  cc: "contact@mitalia.digital",
  bcc: "archives@mitalia.digital",
  subject: "Facture de novembre",
  body: "Bonjour, voici votre facture.",
  threadId: "thread-123",
  draftId: "draft-123",
  inReplyTo: "<message@example.org>",
  references: "<old@example.org> <message@example.org>",
  attachments: [{ data: Buffer.from("PDF"), filename: "facture.pdf", mimeType: "application/pdf" }],
};

describe("MGMail — conversion du formulaire", () => {
  it("préserve les correspondants et les références de conversation", () => {
    const result = composeForMailProvider(payload);
    expect(result.to).toEqual([{ email: "client@exemple.com" }]);
    expect(result.cc).toEqual([{ email: "contact@mitalia.digital" }]);
    expect(result.bcc).toEqual([{ email: "archives@mitalia.digital" }]);
    expect(result.threadId).toBe("thread-123");
    expect(result.draftId).toBe("draft-123");
    expect(result.replyToMessageId).toBe("<message@example.org>");
    expect(result.references).toBe("<old@example.org> <message@example.org>");
    expect(result.attachments?.[0].content.toString()).toBe("PDF");
  });

  it("fonctionne sans pièce jointe ni fil de conversation", () => {
    const result = composeForMailProvider({
      ...payload, cc: "", bcc: "", draftId: undefined, threadId: undefined,
      attachments: [],
    });
    expect(result.cc).toEqual([]);
    expect(result.bcc).toEqual([]);
    expect(result.draftId).toBeUndefined();
    expect(result.attachments).toEqual([]);
  });
});
