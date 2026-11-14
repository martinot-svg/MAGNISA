import { requireOrganization } from "@/lib/current-org";
import { MagniMailClient } from "@/components/magnimail-client";
import { DEFAULT_EMAIL_TEMPLATES, getEmailTemplate, renderEmailTemplate, type EmailTemplateKey } from "@/lib/magnimail/templates";

const MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export default async function MagniMailPage({
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
  const { supabase, organizationId, user } = await requireOrganization();
  const { data: gmail } = await supabase
    .from("email_connections")
    .select("email,status,scopes")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();

  // Le canal interne fonctionne sans connexion Gmail ni domaine Internet.
  const internalPortal = (
    <div className="card section">
      <h2>Boîtes MGMail des collaborateurs</h2>
      <p>Créer, attribuer et partager des boîtes internes ; échanger des messages
        entre collaborateurs autorisés, même sans compte Gmail.</p>
      <p className="muted">Les identifiants en .mgmail sont réservés à MAGNISA :
        ils ne reçoivent pas directement les courriels Internet.</p>
      <a className="button primary" href="/magnimail/interne">Ouvrir la messagerie interne</a>
    </div>
  );

  const agendaPortal = (
    <div className="card section">
      <h2>Agenda et calendrier MGMail</h2>
      <p>Organiser les rendez-vous personnels, réunions de service et événements d'entreprise.
        Les rappels sont prévus dans le centre de notifications MAGNISA.</p>
      <a className="button" href="/magnimail/agenda">Ouvrir le calendrier</a>
    </div>
  );

  if (!gmail || gmail.status !== "active") {
    return (
      <>
        <div className="pageHead">
          <div>
            <p className="eyebrow">Communication</p>
            <h1>MGMail</h1>
            <p>Messagerie interne sécurisée et connexions e-mail externes facultatives.</p>
          </div>
        </div>
        {internalPortal}
      {agendaPortal}
        {agendaPortal}
        <div className="grid2">
          <div className="card">
            <h2>Gmail — facultatif</h2>
            <p className="muted">
              Connecte Gmail uniquement si tu souhaites utiliser une boîte externe pour la réception, les envoyés, les brouillons, les réponses,
              pièces jointes et l'envoi des documents MAGNISA.
            </p>
            <a className="button primary" href="/api/integrations/google/start">
              Connecter Gmail
            </a>
          </div>
          <div className="card">
            <h2>Outlook / Microsoft 365</h2>
            <p className="muted">
              L'architecture MagniMail est prévue pour Microsoft 365. La connexion Microsoft
              sera activée après configuration de l'application Microsoft Entra.
            </p>
            <button className="button" disabled>
              Connexion Microsoft à configurer
            </button>
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
      {internalPortal}
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
            Ton compte était connecté avec l'autorisation d'envoi uniquement. MagniMail a
            maintenant besoin de l'autorisation Gmail complète de lecture/modification pour
            afficher la boîte de réception, les brouillons et la corbeille.
          </p>
          <a className="button primary" href="/api/integrations/google/start">
            Reconnecter Gmail pour MagniMail
          </a>
        </div>
      )}
      <MagniMailClient
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
