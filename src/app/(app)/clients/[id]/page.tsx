import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  await requirePermission(ctx, "billing.view");
  const { supabase, organizationId } = ctx;

  const [
    { data: customer },
    { data: emails = [] },
    { data: quotes = [] },
    { data: invoices = [] },
    { data: projects = [] },
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
              href={`/magnimail?composeTo=${encodeURIComponent(customer.email)}&customerId=${customer.id}`}
            >
              Écrire avec MagniMail
            </Link>
          )}
          <Link className="button" href="/clients">Retour aux clients</Link>
        </div>
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Historique MagniMail</h2>
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
                    {mail.occurred_at ? new Date(mail.occurred_at).toLocaleString("fr-FR") : ""}
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
            <h2>Factures</h2>
            {!invoices.length ? <p className="muted">Aucune facture.</p> : invoices.map((invoice: any) => (
              <div key={invoice.id} style={{ padding: "8px 0", borderBottom: "1px solid #eef1f5" }}>
                <Link href={`/factures/${invoice.id}`}><b>{invoice.number}</b></Link> · {invoice.status}
              </div>
            ))}
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
