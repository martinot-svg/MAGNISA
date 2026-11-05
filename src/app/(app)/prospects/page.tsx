import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { addProspectContributor, createProspectWithOriginator } from "@/server/actions/commissions";

const contributionLabels: Record<string, string> = {
  originator: "Apporteur",
  qualifier: "Qualificateur",
  negotiator: "Négociateur",
  closer: "Convertisseur",
};

export default async function Prospects() {
  const ctx = await requireOrganization();
  const [canViewSales, canContribute] = await Promise.all([
    hasPermission(ctx, "sales.view"),
    hasPermission(ctx, "commissions.contribute"),
  ]);
  if (!canViewSales && !canContribute) redirect("/dashboard?access=denied");

  const { data = [], error } = await ctx.supabase
    .from("prospects")
    .select("id,name,status,email,phone,source,converted_customer_id,created_at")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Impossible de charger les prospects.");

  return (
    <>
      <div className="pageHead">
        <div><h1>Prospects</h1><p>Chaque collaborateur peut apporter un prospect et déclarer ses contributions au cycle commercial.</p></div>
        {canContribute && <div className="actions">
          <FormDialog title="Nouveau prospect" buttonLabel="+ Nouveau prospect">
            <form action={createProspectWithOriginator} className="form">
              <div className="field"><label>Nom ou raison sociale</label><input name="name" required minLength={2} /></div>
              <div className="field"><label>E-mail</label><input name="email" type="email" /></div>
              <div className="field"><label>Téléphone</label><input name="phone" /></div>
              <div className="field"><label>Source</label><input name="source" placeholder="Recommandation, prospection, partenaire..." /></div>
              <div className="field"><label>Notes initiales</label><textarea name="notes" rows={3} /></div>
              <button className="button primary">Créer le prospect et m'attribuer l'apport</button>
            </form>
          </FormDialog>
        </div>}
      </div>
      <div className="section">
        {!data.length ? <EmptyState title="Aucun prospect" description="Ajoute un prospect réel. Tu seras automatiquement enregistré comme apporteur." /> : (
          <div className="tableWrap">
            <table><thead><tr><th>Prospect</th><th>Statut</th><th>Coordonnées</th><th>Source</th><th>Contribution</th></tr></thead>
              <tbody>{data.map((item: any) => <tr key={item.id}>
                <td><strong>{item.name}</strong><div className="muted">{item.id}</div></td>
                <td><span className="badge">{item.status}</span></td>
                <td>{item.email || "—"}<div>{item.phone || ""}</div></td>
                <td>{item.source || "—"}</td>
                <td>{canContribute ? <form action={addProspectContributor} className="inline">
                  <input type="hidden" name="prospect_id" value={item.id} />
                  <select name="contribution_type" aria-label="Rôle de contribution" defaultValue="qualifier">
                    {Object.entries(contributionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                  <button className="button small">Déclarer</button>
                </form> : "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
