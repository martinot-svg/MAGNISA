import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, hasPermission, requirePermission } from "@/lib/permissions";
import { planBillingPreavis } from "@/lib/magnimail/preavis";
import {
  defaultPreavisRules,
  normalizePreavisRules,
  parsePreavisRulesJson,
} from "@/lib/magnimail/preavis-config";
import { MGMailPreavisForm } from "@/components/mgmail-preavis-form";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
}

async function savePreavisPolicy(form: FormData) {
  "use server";

  const ctx = await requireOrganization();
  await assertPermission(ctx, "orders.manage");
  const contractId = String(form.get("contractId") || "default").trim();
  const enabledValue = String(form.get("enabled") || "");
  if (enabledValue !== "true" && enabledValue !== "false") {
    throw new Error("État d'activation du préavis invalide.");
  }
  const rules = parsePreavisRulesJson(String(form.get("rules") || "[]"));
  const recurringContractId = contractId === "default" ? null : contractId;
  const { supabase, organizationId, user } = ctx;

  if (recurringContractId) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(recurringContractId)) {
      throw new Error("Identifiant du contrat invalide.");
    }
    const { data: contract, error: contractError } = await supabase
      .from("recurring_service_contracts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", recurringContractId)
      .maybeSingle();
    if (contractError || !contract) throw new Error("Contrat non autorisé ou introuvable.");
  }

  let lookup = supabase
    .from("mgmail_preavis_policies")
    .select("id")
    .eq("organization_id", organizationId);
  lookup = recurringContractId
    ? lookup.eq("recurring_contract_id", recurringContractId)
    : lookup.is("recurring_contract_id", null);

  const { data: existing, error: lookupError } = await lookup.maybeSingle();
  if (lookupError) throw new Error("Impossible de vérifier la configuration MGMail.");

  const values = {
    enabled: enabledValue === "true",
    rules,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase
      .from("mgmail_preavis_policies")
      .update(values)
      .eq("id", existing.id)
      .eq("organization_id", organizationId);
    if (error) throw new Error("Impossible d'enregistrer la configuration de préavis.");
  } else {
    const { error } = await supabase
      .from("mgmail_preavis_policies")
      .insert({ ...values, organization_id: organizationId, recurring_contract_id: recurringContractId });
    if (error) throw new Error("Impossible de créer la configuration de préavis.");
  }
  revalidatePath("/magnimail/preavis");
}

export default async function BillingPreavisPreview() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "sales.view");
  const canManage = await hasPermission(ctx, "orders.manage");

  const [contractResult, policyResult] = await Promise.all([
    ctx.supabase
      .from("recurring_service_contracts")
      .select("id,description,next_billing_date,status,frequency")
      .eq("organization_id", ctx.organizationId)
      .eq("status", "active")
      .order("next_billing_date", { ascending: true })
      .limit(30),
    ctx.supabase
      .from("mgmail_preavis_policies")
      .select("recurring_contract_id,enabled,rules")
      .eq("organization_id", ctx.organizationId)
      .limit(200),
  ]);

  const contracts = contractResult.data || [];
  const policies = (policyResult.data || []).map((policy) => ({
    contractId: policy.recurring_contract_id as string | null,
    enabled: !!policy.enabled,
    rules: normalizePreavisRules(policy.rules),
  }));
  const globalPolicy = policies.find((policy) => policy.contractId === null);

  // Prévisualisation seulement ; aucune action d'envoi de courrier.
  const today = new Date().toISOString().slice(0, 10);
  const previews = contracts.map((contract) => {
    const policy = policies.find((item) => item.contractId === contract.id) ?? globalPolicy;
    return {
      ...contract,
      events: policy && !policy.enabled ? [] : planBillingPreavis({
        billingDate: contract.next_billing_date,
        contractStatus: contract.status,
        rules: policy?.rules ?? defaultPreavisRules(),
        asOfDate: today,
      }),
    };
  });

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">MGMail · Facturation</p>
          <h1>Préavis de facturation</h1>
          <p>Délais personnalisables avant l'émission prévue des factures récurrentes.</p>
        </div>
        <Link className="button" href="/magnimail">Retour à MGMail</Link>
      </div>
      <div className="card section">
        <strong>Configuration et simulation — aucun e-mail automatique n'est envoyé.</strong>
        <p className="muted">
          Les règles enregistrées s'appliquent aux prévisualisations. Leur exécution
          automatique nécessitera un canal d'envoi réellement configuré, une file
          idempotente et des tests de réception externe.
        </p>
      </div>
      {contractResult.error || policyResult.error ? (
        <div className="card section" role="alert">
          Impossible de charger les contrats ou les règles de préavis.
          Vérifiez l'application des migrations MGMail et les autorisations.
        </div>
      ) : (
        <>
          <MGMailPreavisForm
            contracts={contracts.map(({ id, description }) => ({ id, description }))}
            policies={policies}
            canManage={canManage}
            saveAction={savePreavisPolicy}
          />
          {previews.length === 0 ? (
            <div className="card section"><p>Aucun contrat récurrent actif à prévisualiser.</p></div>
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
      )}
    </>
  );
}
