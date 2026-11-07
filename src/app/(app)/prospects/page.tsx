import { redirect } from "next/navigation";
import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { convertProspectToCustomer, createProspect } from "@/server/actions/commissions";

export default async function ProspectsPage() {
  const ctx = await requireOrganization();
  const [canViewSales, canContribute, canConvert] = await Promise.all([
    hasPermission(ctx, "sales.view"),
    hasPermission(ctx, "commissions.contribute"),
    hasPermission(ctx, "prospects.convert"),
  ]);
  if (!canViewSales && !canContribute) redirect("/dashboard?access=denied");

  const { data: prospects = [], error } = await ctx.supabase
    .from("prospects")
    .select("id,name,email,phone,source,status,converted_customer_id,created_at")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Impossible de charger les prospects.");

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Prospects</h1>
          <p>Suivi des contacts et des contributions. Le passage au statut Gagné crée automatiquement la fiche client.</p>
        </div>
        {canContribute && (
          <div className="actions">
            <FormDialog title="Nouveau prospect" buttonLabel="+ Nouveau prospect">
              <form action={createProspect} className="form">
                <div className="field"><label>Nom / raison sociale</label><input name="name" minLength={2} maxLength={180} required /></div>
                <div className="field"><label>E-mail</label><input name="email" type="email" maxLength={254} /></div>
                <div className="field"><label>Téléphone</label><input name="phone" maxLength={40} /></div>
                <div className="field"><label>Source</label><input name="source" maxLength={120} placeholder="Recommandation, appel, visite…" /></div>
                <div className="field"><label>Notes</label><textarea name="notes" rows={3} maxLength={2000} /></div>
                <button className="button primary">Créer le prospect</button>
              </form>
            </FormDialog>
          </div>
        )}
      </div>
      <div className="section">
        {!prospects.length ? (
          <EmptyState title="Aucun prospect" description="Crée un prospect réel pour démarrer le suivi commercial." />
        ) : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Prospect</th><th>Statut</th><th>Contact</th><th>Source</th><th>Conversion</th><th>Action</th></tr></thead>
              <tbody>
                {prospects.map((prospect: any) => (
                  <tr key={prospect.id}>
                    <td><strong><Link href={`/prospects/${prospect.id}`}>{prospect.name}</Link></strong><div className="muted">{new Date(prospect.created_at).toLocaleDateString("fr-FR")}</div></td>
                    <td><span className="badge">{prospect.status}</span></td>
                    <td>{prospect.email || "—"}<div className="muted">{prospect.phone || ""}</div></td>
                    <td>{prospect.source || "—"}</td>
                    <td>{prospect.converted_customer_id ? <span className="badge">Client créé</span> : "Non converti"}</td>
                    <td>
                      {canConvert && !prospect.converted_customer_id && prospect.status !== "lost" ? (
                        <form action={convertProspectToCustomer}>
                          <input type="hidden" name="prospect_id" value={prospect.id} />
                          <button className="button small">Clôturer comme gagné</button>
                        </form>
                      ) : prospect.converted_customer_id ? "Déjà converti" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
