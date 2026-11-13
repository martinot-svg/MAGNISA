import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { DEFAULT_PREAVIS_RULES, planBillingPreavis } from "@/lib/magnimail/preavis";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
}

export default async function BillingPreavisPreview() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "sales.view");

  const { data: contracts, error } = await ctx.supabase
    .from("recurring_service_contracts")
    .select("id,description,next_billing_date,status,frequency")
    .eq("organization_id", ctx.organizationId)
    .eq("status", "active")
    .order("next_billing_date", { ascending: true })
    .limit(30);

  // Planification affichée pour consultation, pas encore reliée au moteur d'envoi.
  const today = new Date().toISOString().slice(0, 10);
  const previews = (contracts || []).map((contract) => ({
    ...contract,
    events: planBillingPreavis({
      billingDate: contract.next_billing_date,
      contractStatus: contract.status,
      rules: DEFAULT_PREAVIS_RULES,
      asOfDate: today,
    }),
  }));

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">MGMail · Facturation</p>
          <h1>Préavis de facturation</h1>
          <p>Prévisualisation des dates avant l'émission prévue des factures récurrentes.</p>
        </div>
        <Link className="button" href="/magnimail">Retour à MGMail</Link>
      </div>
      <div className="card section">
        <strong>Simulation uniquement — aucun e-mail n'est envoyé depuis cette page.</strong>
        <p className="muted">
          Les délais J−15, J−10, J−5 et J−1 sont les valeurs proposées par défaut.
          Les délais personnalisés, la gestion des destinataires et l'envoi automatique
          sécurisé seront activés uniquement lorsque le traitement MGMail sera opérationnel.
        </p>
      </div>
      {error ? (
        <div className="card section" role="alert">
          Impossible de charger les prestations récurrentes autorisées.
        </div>
      ) : previews.length === 0 ? (
        <div className="card section">
          <p>Aucun contrat récurrent actif à prévisualiser.</p>
        </div>
      ) : (
        <div className="grid2">
          {previews.map((contract) => (
            <div className="card" key={contract.id}>
              <h2>{contract.description}</h2>
              <p className="muted">Prochaine facturation prévue : {dateLabel(contract.next_billing_date)}</p>
              {contract.events.length === 0 ? (
                <p>Aucun préavis futur pour cette échéance.</p>
              ) : (
                <ul>
                  {contract.events.map((event) => (
                    <li key={event.ruleId}>
                      <strong>J−{event.daysBefore}</strong> — {dateLabel(event.scheduledDate)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
