import { gmailProvider } from "./google";
import { MailProviderError, type MailProviderAdapter, type MailProviderId } from "./types";

/**
 * Point d'entrée des fournisseurs MGMail.
 * Aucune intégration non opérationnelle ne doit être annoncée comme disponible.
 * Les futurs adaptateurs Microsoft Graph / IMAP-SMTP seront enregistrés ici
 * une fois leur authentification, autorisation et tests d'intégration établis.
 */
export function getMailProvider(provider: MailProviderId): MailProviderAdapter {
  if (provider === "google") return gmailProvider;
  throw new MailProviderError(
    "Ce fournisseur MGMail n'est pas encore configuré et opérationnel.",
    "UNSUPPORTED",
  );
}
