import { getMailProvider } from "./index";
import { MailProviderError, type MailProviderId, type MailProviderContext } from "./types";

export type MailConnectionSelection = {
  id: string;
  email: string;
  provider: string;
  status: string;
};

type OrganizationContext = {
  supabase: {
    from: (table: string) => any;
  };
  organizationId: string;
  user: { id: string };
};

const providerIds: readonly MailProviderId[] = ["google", "microsoft", "imap"];

export function selectMailConnection(
  rows: readonly MailConnectionSelection[],
  requestedId?: string | null,
): MailConnectionSelection {
  const active = rows.filter((row) => row.status === "active");

  // A supplied ID can never silently fall back to a different mailbox.
  const chosen = requestedId
    ? active.find((row) => row.id === requestedId)
    : active.find((row) => row.provider === "google") ?? active[0];

  if (!chosen) {
    throw new MailProviderError(
      requestedId ? "Boîte MGMail inaccessible ou inactive." : "Aucune boîte e-mail active n'est connectée.",
      requestedId ? "PERMISSION_DENIED" : "NOT_CONNECTED",
    );
  }
  if (!providerIds.includes(chosen.provider as MailProviderId)) {
    throw new MailProviderError("Fournisseur de messagerie non pris en charge.", "UNSUPPORTED");
  }
  return chosen;
}

/**
 * Résout une boîte strictement pour l'utilisateur et l'organisation authentifiés.
 * Aucune connexion tierce ne peut être sélectionnée par un simple ID d'URL.
 */
export async function resolveUserMailProvider(
  ctx: OrganizationContext,
  requestedId?: string | null,
) {
  if (requestedId && (requestedId.length > 128 || !/^[0-9a-f-]{36}$/i.test(requestedId))) {
    throw new MailProviderError("Identifiant de boîte MGMail invalide.", "PERMISSION_DENIED");
  }

  const { data, error } = await ctx.supabase
    .from("email_connections")
    .select("id,email,provider,status")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.user.id)
    .eq("status", "active")
    .order("connected_at", { ascending: true })
    .limit(100);

  if (error) {
    throw new MailProviderError("Impossible de charger les boîtes MGMail autorisées.", "UPSTREAM_ERROR", true);
  }

  const connection = selectMailConnection((data ?? []) as MailConnectionSelection[], requestedId);
  const provider = getMailProvider(connection.provider as MailProviderId);
  const context: MailProviderContext = {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    connectionId: connection.id,
  };
  return { provider, context, connection };
}

export function mailProviderHttpError(error: unknown) {
  if (error instanceof MailProviderError) {
    const statuses = {
      NOT_CONNECTED: 409,
      AUTH_REQUIRED: 401,
      PERMISSION_DENIED: 403,
      NOT_FOUND: 404,
      RATE_LIMITED: 429,
      UNSUPPORTED: 501,
      UPSTREAM_ERROR: 502,
    } as const;
    return { error: error.message, status: statuses[error.code] };
  }
  // Do not return raw OAuth, provider or database errors to users.
  return { error: "Une erreur MGMail est survenue. Réessayez ou vérifiez la connexion.", status: 500 };
}
