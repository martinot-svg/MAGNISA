import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google/gmail", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/google/gmail")>();
  return {
    ...real,
    getGmailAccess: vi.fn(),
    sendGmailRaw: vi.fn(),
    updateGmailDraft: vi.fn(),
    sendGmailDraft: vi.fn(),
  };
});

import {
  getGmailAccess, sendGmailRaw, updateGmailDraft, sendGmailDraft,
} from "@/lib/google/gmail";
import { gmailProvider } from "./google";

const context = { organizationId: "org", userId: "user", connectionId: "connection-1" };
const message = {
  to: [{ email: "client@gmail.com" }],
  subject: "Facture",
  textBody: "Bonjour",
  references: "<original@example.org>",
  replyToMessageId: "<reply@example.org>",
};

describe("MGMail — envoi Gmail sans régression", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getGmailAccess).mockResolvedValue({
      connection: { id: "connection-1", email: "finance@mitalia.digital" },
      accessToken: "access-token",
    });
  });

  it("envoie un nouveau message une seule fois", async () => {
    vi.mocked(sendGmailRaw).mockResolvedValue({ id: "sent-1", threadId: "thread-1" });
    const sent = await gmailProvider.sendMessage({ context, message });
    expect(sent).toEqual({ messageId: "sent-1", threadId: "thread-1" });
    expect(sendGmailRaw).toHaveBeenCalledOnce();
    expect(updateGmailDraft).not.toHaveBeenCalled();
    expect(sendGmailDraft).not.toHaveBeenCalled();
    const mime = vi.mocked(sendGmailRaw).mock.calls[0][1];
    const decoded = Buffer.from(mime, "base64url").toString("utf8");
    expect(decoded).toContain("From: finance@mitalia.digital");
    expect(decoded).toContain("In-Reply-To: <reply@example.org>");
    expect(decoded).toContain("References: <original@example.org>");
  });

  it("met à jour puis envoie un brouillon existant sans nouveau message parallèle", async () => {
    vi.mocked(updateGmailDraft).mockResolvedValue({ id: "draft-1" });
    vi.mocked(sendGmailDraft).mockResolvedValue({ id: "sent-2", threadId: "thread-2" });
    const sent = await gmailProvider.sendMessage({
      context,
      message: { ...message, draftId: "draft-1", threadId: "thread-2" },
    });
    expect(sent.messageId).toBe("sent-2");
    expect(updateGmailDraft).toHaveBeenCalledOnce();
    expect(sendGmailDraft).toHaveBeenCalledWith("access-token", "draft-1");
    expect(sendGmailRaw).not.toHaveBeenCalled();
  });

  it("refuse une boîte dont l'identifiant ne correspond pas au compte autorisé", async () => {
    await expect(gmailProvider.sendMessage({
      context: { ...context, connectionId: "another-connection" },
      message,
    })).rejects.toThrow(/non autorisée/);
    expect(sendGmailRaw).not.toHaveBeenCalled();
  });
});
