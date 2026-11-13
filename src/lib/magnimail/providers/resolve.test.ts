import { describe, expect, it } from "vitest";
import { selectMailConnection, mailProviderHttpError } from "./resolve";
import { MailProviderError } from "./types";

const connections = [
  { id: "11111111-1111-4111-8111-111111111111", email: "outlook@example.org", provider: "microsoft", status: "active" },
  { id: "22222222-2222-4222-8222-222222222222", email: "contact@example.org", provider: "google", status: "active" },
  { id: "33333333-3333-4333-8333-333333333333", email: "old@example.org", provider: "google", status: "revoked" },
] as const;

describe("MGMail — sélection sécurisée du fournisseur", () => {
  it("conserve Gmail connecté par défaut pendant la transition", () => {
    expect(selectMailConnection(connections).email).toBe("contact@example.org");
  });

  it("permet la sélection explicite d'une boîte différente", () => {
    expect(selectMailConnection(connections, connections[0].id).provider).toBe("microsoft");
  });

  it("refuse la substitution silencieuse d'une boîte inaccessible", () => {
    expect(() => selectMailConnection(connections, connections[2].id)).toThrow(/inaccessible/);
    expect(() => selectMailConnection(connections, "unknown-id")).toThrow(/inaccessible/);
  });

  it("distingue absence de connexion et fournisseur non pris en charge", () => {
    expect(() => selectMailConnection([])).toThrow(MailProviderError);
    expect(() => selectMailConnection([
      { id: "b", email: "a@example.org", provider: "unknown", status: "active" },
    ])).toThrow(/non pris en charge/);
  });

  it("retourne les statuts HTTP métier sans exposer les erreurs techniques", () => {
    expect(mailProviderHttpError(new MailProviderError("Accès refusé", "PERMISSION_DENIED"))).toEqual({
      error: "Accès refusé", status: 403,
    });
    expect(mailProviderHttpError(new MailProviderError("Pas de connexion", "NOT_CONNECTED")).status).toBe(409);
    const untrusted = mailProviderHttpError(new Error("secret de fournisseur"));
    expect(untrusted.status).toBe(500);
    expect(untrusted.error).not.toContain("secret de fournisseur");
  });
});
