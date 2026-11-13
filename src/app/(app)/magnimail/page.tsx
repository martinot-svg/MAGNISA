import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { MGMailClient } from "@/components/magnimail-client";
import { DEFAULT_EMAIL_TEMPLATES, getEmailTemplate, renderEmailTemplate, type EmailTemplateKey } from "@/lib/magnimail/templates";

const MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export default async function MGMailPage({
  searchParams,
}: {
  searchParams: Promise<{
    composeTo?: string;
    customerId?: string;
    templateKey?: string;
    numero?: string;
    quoteId?: string;
    invoiceId?: string;
    projectId?: string;
    creditNoteId?: string;
    paymentId?: string;
  }>;
}) {
  const query = await searchParams;
  const { supabase, organizationId, user, role } = await requireOrganization();
  const canViewBillingPreavis = await hasPermission({ supabase, organizationId, role }, "sales.view");
  const canConfigureMail = role === "owner" || role === "admin";
  const { data: gmail } = await supabase
    .from("email_connections")
    .select("email,status,scopes")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();

  // Gmail est une connexion facultative : MGMail reste accessible sans compte Google.
  // Aucun appel aux API Gmail n'est effectué dans cet état.
  if (!gmail || gmail.status !== "active") {
    return (
      <>
        <div className="pageHead">
          <div>
            <p className="eyebrow">Communication</p>
            <h1>MGMail</h1>
            <p>Votre espace de communication MAGNISA, indépendant d'un compte Google.</p>
          </div>
        </div>
        <div className="card section">
          <h2>Bienvenue dans MGMail</h2>
          <p>
            Aucun compte Gmail n'est nécessaire pour accéder à MAGNISA.
            Pour échanger des e-mails sur Internet avec vos clients et partenaires,
            une boîte professionnelle doit toutefois être réellement configurée.
          </p>
          <p className="muted">
            Aucune boîte Internet opérationnelle n'est connectée à votre espace.
            Les boîtes internes des collaborateurs sont accessibles dans l'espace
            de communication MAGNISA. L'envoi Internet par domaine personnalisé
            reste à configurer et à vérifier.
          </p>
          <a className="button primary" href="/magnimail/interne">Ouvrir la messagerie interne</a>
          {canConfigureMail && <a className="button" href="/parametres">Consulter la configuration e-mail</a>}
          {canViewBillingPreavis && <a className="button" href="/magnimail/preavis">Préavis de facturation</a>}
        </div>
        <div className="grid2">
          <div className="card">
            <h2>Gmail — facultatif</h2>
            <p className="muted">
              Vous pouvez connecter Gmail si vous souhaitez utiliser une boîte
              existante. Ce choix n'est pas obligatoire pour votre compte MAGNISA.
            </p>
            {canConfigureMail ? (
              <a className="button" href="/api/integrations/google/start">Connecter Gmail (facultatif)</a>
            ) : (
              <p className="muted">Seul un administrateur peut connecter une boîte e-mail.</p>
            )}
          </div>
          <div className="card">
            <h2>Autres messageries professionnelles</h2>
            <p className="muted">
              Microsoft 365, fournisseurs IMAP/SMTP et adresses MGMail propres
              sont en cours d'intégration. Aucune connexion inactive n'est
              présentée comme fonctionnelle.
            </p>
            <p className="muted">Envoi et réception externes : non configurés.</p>
          </div>
        </div>
      </>
    );
  }

  let initialSubject = "";
  let initialBody = "";
  const templateKey = String(query.templateKey || "");
  if (templateKey && DEFAULT_EMAIL_TEMPLATES.some((item) => item.key === templateKey)) {
    let clientName = "Client";
    if (query.customerId) {
      const { data: customer } = await supabase
        .from("customers")
        .select("name")
        .eq("organization_id", organizationId)
        .eq("id", query.customerId)
        .maybeSingle();
      if (customer?.name) clientName = customer.name;
    }
    const template = await getEmailTemplate(
      supabase,
      organizationId,
      templateKey as EmailTemplateKey,
    );
    const variables = { client: clientName, numero: query.numero || "" };
    initialSubject = renderEmailTemplate(template.subject, variables);
    initialBody = renderEmailTemplate(template.body, variables);
  }

  const scopes = Array.isArray(gmail.scopes) ? gmail.scopes : [];
  const needsUpgrade = !scopes.includes(MODIFY_SCOPE);

  return (
    <>
      {needsUpgrade && (
        <div
          className="card"
          style={{
            marginBottom: 18,
            border: "1px solid #fde68a",
            background: "#fffbeb",
          }}
        >
          <strong>Autorisation Gmail à mettre à niveau</strong>
          <p style={{ marginBottom: 12 }}>
            Ton compte était connecté avec l'autorisation d'envoi uniquement. MGMail a
            maintenant besoin de l'autorisation Gmail complète de lecture/modification pour
            afficher la boîte de réception, les brouillons et la corbeille.
          </p>
          <a className="button primary" href="/api/integrations/google/start">
            Reconnecter Gmail pour MGMail
          </a>
        </div>
      )}
      <div className="actions" style={{ marginBottom: 12 }}>
        <a className="button" href="/magnimail/interne">Boîtes internes des collaborateurs</a>
      </div>
      <MGMailClient
        canViewBillingPreavis={canViewBillingPreavis}
        connectedEmail={gmail.email}
        initialTo={query.composeTo || ""}
        initialCustomerId={query.customerId || ""}
        initialSubject={initialSubject}
        initialBody={initialBody}
        initialQuoteId={query.quoteId || ""}
        initialInvoiceId={query.invoiceId || ""}
        initialProjectId={query.projectId || ""}
        initialCreditNoteId={query.creditNoteId || ""}
        initialPaymentId={query.paymentId || ""}
      />
    </>
  );
}
