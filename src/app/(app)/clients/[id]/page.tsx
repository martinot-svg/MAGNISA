import { FormDialog } from "@/components/form-dialog";
import { formatDateTimeDisplay } from "@/lib/date-format";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { setCustomerActive, updateCustomer } from "@/server/actions/core";

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  await requirePermission(ctx, "billing.view");
  const canManageCustomers = await hasPermission(ctx, "customers.create");
  const { supabase, organizationId } = ctx;

  const [
    { data: customer },
    { data: emails = [] },
    { data: quotes = [] },
    { data: invoices = [] },
    { data: projects = [] },
    { data: orders = [] },
    { data: recurringContracts = [] },
    { data: payments = [] },
  ] = await Promise.all([
    supabase
      .from("customers")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("email_history")
      .select("id,direction,from_email,to_emails,subject,snippet,occurred_at,quote_id,invoice_id,project_id,attachment_names")
      .eq("organization_id", organizationId)
      .eq("customer_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("quotes")
      .select("id,number,status,total,created_at")
      .eq("organization_id", organizationId)
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("invoices")
      .select("id,number,status,total,balance_due,created_at")
      .eq("organization_id", organizationId)
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("projects")
      .select("id,name,status,created_at")
      .eq("organization_id", organizationId)
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("orders")
      .select("id,number,status,total,order_date,created_at")
      .eq("organization_id", organizationId)
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("recurring_service_contracts")
      .select("id,description,frequency,custom_interval_days,next_billing_date,start_date,end_date,status,billing_timing")
      .eq("organization_id", organizationId)
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("payments")
      .select("id,invoice_id,reference,amount,method,status,paid_at,invoices(number)")
      .eq("organization_id", organizationId)
      .eq("customer_id", id)
      .order("paid_at", { ascending: false })
      .limit(50),
  ]);

  if (!customer) notFound();

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Client</p>
          <h1>{customer.name}</h1>
          <p>{customer.email || "Aucun e-mail"} · {customer.phone || "Aucun téléphone"}</p>
        </div>
        <div className="actions">
          {customer.email && (
            <Link
              className="button primary"
              href={`/orbit/magnibox?composeTo=${encodeURIComponent(customer.email)}&customerId=${customer.id}`}
            >
              Écrire avec Magnibox
            </Link>
          )}
          <Link className="button" href={"/clients/" + customer.id + "/contributions"}>Suivi collaboratif</Link>
          <Link className="button" href="/clients">Retour aux clients</Link>
        </div>
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Modifier les coordonnées</h2>
          <p className="muted">Les modifications concernent les coordonnées actuelles du client. Les documents déjà émis conservent leur historique.</p>
          {canManageCustomers ? (
            <>
              <FormDialog title="Modifier la fiche client" buttonLabel="Enregistrer les modifications"><form action={updateCustomer} className="form">
                <input type="hidden" name="id" value={customer.id} />
                <div className="field"><label>Nom / raison sociale</label><input name="name" defaultValue={customer.name} required minLength={2} /></div>
                <div className="field"><label>E-mail</label><input name="email" type="email" defaultValue={customer.email || ""} /></div>
                <div className="field"><label>Téléphone</label><input name="phone" defaultValue={customer.phone || ""} /></div>
                <div className="field"><label>Adresse</label><textarea name="address" defaultValue={customer.address || ""} /></div>
                <div className="field"><label>Identifiant fiscal</label><input name="tax_id" defaultValue={customer.tax_id || ""} /></div>
                <button className="button primary">Enregistrer les modifications</button>
              </form></FormDialog>
              <hr />
              <h3>{customer.is_active ? "Supprimer / archiver le client" : "Client archivé"}</h3>
              <p className="muted">{customer.is_active
                ? "Le client sera masqué des listes actives, mais ses devis, factures, paiements et historiques seront conservés."
                : "Ce client est archivé. Tu peux le réactiver pour le rendre à nouveau disponible."}</p>
              <FormDialog title="Modifier le statut du client" buttonLabel="Modifier le statut"><form action={setCustomerActive} className="actions">
                <input type="hidden" name="id" value={customer.id} />
                <input type="hidden" name="is_active" value={customer.is_active ? "false" : "true"} />
                <button className="button" type="submit">{customer.is_active ? "Confirmer l'archivage" : "Réactiver le client"}</button>
              </form></FormDialog>
            </>
          ) : (
            <p className="muted">Consultation seule : les droits de modification de la fiche client ne sont pas accordés.</p>
          )}
        </section>
        <section className="card">
          <h2>Historique Magnibox</h2>
          <p className="muted">
            Les e-mails envoyés depuis MAGNISA et les messages Gmail synchronisés sont rattachés automatiquement à ce client.
          </p>
          {!emails.length ? (
            <p className="muted">Aucun e-mail rattaché pour le moment.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {emails.map((mail: any) => (
                <div
                  key={mail.id}
                  style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{mail.subject || "(Sans objet)"}</strong>
                    <span className="badge">
                      {mail.direction === "outgoing" ? "Envoyé" : mail.direction === "incoming" ? "Reçu" : "Brouillon"}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 5 }}>
                    {mail.occurred_at ? formatDateTimeDisplay(mail.occurred_at) : ""}
                  </div>
                  {mail.snippet && <p style={{ marginBottom: 4 }}>{mail.snippet}</p>}
                  {!!mail.attachment_names?.length && (
                    <small className="muted">Pièces jointes : {mail.attachment_names.join(", ")}</small>
                  )}
                  <div className="actions" style={{ marginTop: 8 }}>
                    {mail.quote_id && <Link className="button" href={`/devis/${mail.quote_id}`}>Voir le devis</Link>}
                    {mail.invoice_id && <Link className="button" href={`/factures/${mail.invoice_id}`}>Voir la facture</Link>}
                    {mail.project_id && <Link className="button" href="/projets">Voir les projets</Link>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <h2>Devis</h2>
            {!quotes.length ? <p className="muted">Aucun devis.</p> : quotes.map((q: any) => (
              <div key={q.id} style={{ padding: "8px 0", borderBottom: "1px solid #eef1f5" }}>
                <Link href={`/devis/${q.id}`}><b>{q.number}</b></Link> · {q.status}
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Abonnements et prestations récurrentes</h2>
            {!recurringContracts.length ? <p className="muted">Aucun contrat récurrent associé à ce client.</p> : recurringContracts.map((contract: any) => (
              <div key={contract.id} style={{ padding: "10px 0", borderBottom: "1px solid #eef1f5" }}>
                <div className="actions">
                  <strong>{contract.description || "Prestation récurrente"}</strong>
                  <span className="badge">{contract.status === "active" ? "Active" : contract.status === "suspended" ? "Suspendue" : contract.status === "cancelled" ? "Résiliée" : contract.status}</span>
                </div>
                <div className="muted">
                  Fréquence : {contract.frequency === "custom" ? `Tous les ${contract.custom_interval_days || "?"} jours` : ({ daily: "Quotidienne", weekly: "Hebdomadaire", monthly: "Mensuelle", quarterly: "Trimestrielle", semiannual: "Semestrielle", annual: "Annuelle" } as Record<string, string>)[contract.frequency] || contract.frequency}
                  · Prochaine échéance : {contract.status === "active" ? contract.next_billing_date || "Non définie" : "—"}
                </div>
                <div className="muted">
                  Période : {contract.start_date} au {contract.end_date || "sans date de fin"}
                  · Facturation : {contract.billing_timing === "arrears" ? "Après prestation" : "D'avance"}
                </div>
              </div>
            ))}
            <div className="actions" style={{ marginTop: 10 }}>
              <Link className="button" href="/prestations-recurrentes">Gérer les prestations récurrentes</Link>
            </div>
          </div>
          <div className="card">
            <h2>Commandes</h2>
            {!orders.length ? <p className="muted">Aucune commande.</p> : orders.map((order: any) => (
              <div key={order.id} style={{ padding: "8px 0", borderBottom: "1px solid #eef1f5" }}>
                <strong>{order.number || "Commande"}</strong> · {order.status}
                <div className="muted">{order.order_date || formatDateTimeDisplay(order.created_at)} · Total : {Number(order.total || 0).toLocaleString("fr-FR")}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Factures</h2>
            {!invoices.length ? <p className="muted">Aucune facture.</p> : invoices.map((invoice: any) => (
              <div key={invoice.id} style={{ padding: "8px 0", borderBottom: "1px solid #eef1f5" }}>
                <Link href={`/factures/${invoice.id}`}><b>{invoice.number}</b></Link> · {invoice.status}
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Paiements reçus</h2>
            {!payments.length ? <p className="muted">Aucun paiement enregistré.</p> : (
              <div className="tableWrap"><table>
                <thead><tr><th>Date</th><th>Facture</th><th>Mode</th><th>Référence</th><th>Statut</th><th className="right">Montant</th></tr></thead>
                <tbody>{payments.map((payment: any) => {
                  const invoice = Array.isArray(payment.invoices) ? payment.invoices[0] : payment.invoices;
                  return <tr key={payment.id}>
                    <td>{payment.paid_at ? formatDateTimeDisplay(payment.paid_at) : "—"}</td>
                    <td><Link href={`/factures/${payment.invoice_id}`}>{invoice?.number || "Voir facture"}</Link></td>
                    <td>{({bank_transfer:"Virement",cash:"Espèces",mobile_money:"Mobile money",cheque:"Chèque",card:"Carte",other:"Autre"} as Record<string,string>)[payment.method] || payment.method}</td>
                    <td>{payment.reference || "—"}</td>
                    <td>{({pending_verification:"À vérifier",confirmed:"Confirmé",reconciled:"Rapproché",cancelled:"Annulé"} as Record<string,string>)[payment.status] || payment.status}</td>
                    <td className="right">{Number(payment.amount).toLocaleString("fr-FR")}</td>
                  </tr>;
                })}</tbody>
              </table></div>
            )}
          </div>
          <div className="card">
            <h2>Projets & missions</h2>
            {!projects.length ? <p className="muted">Aucun projet.</p> : projects.map((project: any) => (
              <div key={project.id} style={{ padding: "8px 0", borderBottom: "1px solid #eef1f5" }}>
                <b>{project.name}</b> · {project.status}
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
