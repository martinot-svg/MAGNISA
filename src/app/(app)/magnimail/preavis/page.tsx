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
import { FormDialog } from "@/components/form-dialog";
import { configureMGMailBillingPreavis } from "@/lib/magnimail/scheduled-actions";

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
  const canConfigureDelivery = canManage && await hasPermission(ctx, "users.manage");

  const [contractResult, policyResult, deliveryResult, identityResult] = await Promise.all([
    ctx.supabase
      .from("recurring_service_contracts")
      .select("id,customer_id,description,next_billing_date,status,frequency")
      .eq("organization_id", ctx.organizationId)
      .eq("status", "active")
      .order("next_billing_date", { ascending: true })
      .limit(30),
    ctx.supabase
      .from("mgmail_preavis_policies")
      .select("recurring_contract_id,enabled,rules")
      .eq("organization_id", ctx.organizationId)
      .limit(200),
    ctx.supabase.from("mgmail_preavis_delivery_configs")
      .select("recurring_contract_id,identity_id,enabled,recipient_confirmed")
      .eq("organization_id", ctx.organizationId).limit(200),
    ctx.supabase.from("mgmail_external_identities")
      .select("id,mailbox_id,email_address,status,receive_enabled")
      .eq("organization_id", ctx.organizationId).eq("status", "active").limit(100),
  ]);

  const contracts = contractResult.data || [];
  const customerIds = [...new Set(contracts.map((contract) => contract.customer_id))];
  const customerResult = await ctx.supabase.from("customers")
    .select("id,name,email,is_active").eq("organization_id", ctx.organizationId)
    .in("id", customerIds);
  const customers = new Map((customerResult.data || []).map((customer) => [customer.id, customer]));
  const deliveryConfigs = new Map((deliveryResult.data || []).map((config) => [config.recurring_contract_id, config]));
  const usableIdentities = canConfigureDelivery ? (await Promise.all((identityResult.data || [])
    .filter((identity) => identity.receive_enabled)
    .map(async (identity) => {
    const result = await ctx.supabase.rpc("mgmail_can_external_access", {
      p_org: ctx.organizationId, p_mailbox: identity.mailbox_id, p_action: "send",
    });
    return result.error || result.data !== true ? null : identity;
  }))).filter((item): item is NonNullable<typeof item> => item !== null) : [];
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
        <strong>{process.env.MGMAIL_AUTO_SEND_ENABLED === "true"
          ? "Programmation active uniquement pour les contrats explicitement autorisés."
          : "Configuration et simulation — les envois automatiques ne sont pas activés."}</strong>
        <p className="muted">
          Les délais restent personnalisables. Un préavis externe ne peut être mis
          en file que si le responsable autorise le contrat et confirme le destinataire,
          avec une adresse Internet vérifiée et un moteur MGMail activé côté serveur.
        </p>
      </div>
      {contractResult.error || policyResult.error || deliveryResult.error || identityResult.error || customerResult.error ? (
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
          <div className="card section">
            <h2>Préavis automatiques envoyés aux clients</h2>
            <p className="muted">
              Un responsable peut autoriser les courriers J−15, J−10, J−5, J−1
              ou tout autre délai enregistré pour chaque contrat. MGMail doit
              pouvoir recevoir la réponse du client sur l'adresse expéditrice.
              L'autorisation est désactivée par défaut.
            </p>
            {!canConfigureDelivery ? (
              <p className="muted">Seuls les responsables disposant des droits de facturation et d'administration peuvent activer les préavis Internet.</p>
            ) : usableIdentities.length === 0 ? (
              <p className="muted">Aucune adresse MGMail Internet autorisée et vérifiée. Configurez d'abord une boîte d'envoi externe.</p>
            ) : (
              <div className="tableWrap">
                <table>
                  <thead><tr><th>Contrat</th><th>Client destinataire</th><th>État</th><th>Configuration</th></tr></thead>
                  <tbody>
                    {contracts.map((contract) => {
                      const customer = customers.get(contract.customer_id);
                      const config = deliveryConfigs.get(contract.id);
                      return (
                        <tr key={contract.id}>
                          <td>{contract.description}</td>
                          <td style={{ overflowWrap: "anywhere" }}>{customer?.email || "Adresse manquante"}</td>
                          <td>{config?.enabled && config.recipient_confirmed
                            ? "Autorisé" : "Inactif"}</td>
                          <td>
                            <FormDialog title="Autoriser les préavis du contrat" buttonLabel="Configurer" buttonClassName="button">
                              <form action={configureMGMailBillingPreavis} className="form">
                                <input type="hidden" name="contractId" value={contract.id} />
                                <p>Prestation : {contract.description}</p>
                                <p>Destinataire : {customer?.name || "Client"} — {customer?.email || "adresse manquante"}</p>
                                <div className="field">
                                  <label>Adresse MGMail expéditrice</label>
                                  <select name="identityId" defaultValue={config?.identity_id || ""} required>
                                    <option value="">Choisir une adresse autorisée</option>
                                    {usableIdentities.map((identity) => (
                                      <option key={identity.id} value={identity.id}>{identity.email_address}</option>
                                    ))}
                                  </select>
                                </div>
                                <label><input type="checkbox" name="recipientConfirmed" defaultChecked={config?.recipient_confirmed || false} />
                                  J'ai vérifié l'adresse du client et son accord pour les préavis de facturation.
                                </label>
                                <label><input type="checkbox" name="enabled" defaultChecked={config?.enabled || false} />
                                  Activer les préavis externes pour cette prestation
                                </label>
                                <p className="muted">Aucun envoi ne part tant que le moteur sécurisé et le domaine Internet n'ont pas été activés.</p>
                                <button className="button primary" type="submit">Enregistrer les autorisations</button>
                              </form>
                            </FormDialog>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
