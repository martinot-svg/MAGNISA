import { FormDialog } from "@/components/form-dialog";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { saveProspectInterventionTypes } from "@/server/actions/commissions";

export default async function ProspectSettingsPage() {
  const ctx = await requireOrganization();
  if (!(await hasPermission(ctx, "commissions.policy.manage"))) redirect("/dashboard?access=denied");
  const { data: types = [], error } = await ctx.supabase.rpc("list_prospect_intervention_types", {
    p_org: ctx.organizationId,
  });
  if (error) throw new Error("Impossible de charger le catalogue des interventions.");
  return <>
    <div className="pageHead">
      <div><p className="eyebrow">Configuration CRM</p><h1>Types d'intervention</h1>
        <p>Active ou désactive les étapes, adapte leurs libellés et impose un justificatif lorsque la nature de l'intervention l'exige.</p></div>
      <Link className="button" href="/prospects">Retour aux prospects</Link>
    </div>
    <section className="section">
      <FormDialog title="Configurer les types d’intervention prospect" buttonLabel="Enregistrer la configuration"><form action={saveProspectInterventionTypes} className="form card">
        <div className="tableWrap"><table>
          <thead><tr><th>Type</th><th>Libellé affiché</th><th>Actif</th><th>Preuve obligatoire</th></tr></thead>
          <tbody>{(types as any[]).map((item:any)=><tr key={item.intervention_type}>
            <td><code>{item.intervention_type}</code></td>
            <td><input name={"label_"+item.intervention_type} defaultValue={item.label} minLength={2} maxLength={80} required /></td>
            <td><input aria-label={"Activer "+item.label} type="checkbox" name={"active_"+item.intervention_type} defaultChecked={item.is_active}/></td>
            <td><input aria-label={"Exiger une preuve pour "+item.label} type="checkbox" name={"evidence_"+item.intervention_type} defaultChecked={item.requires_evidence}/></td>
          </tr>)}</tbody>
        </table></div>
        <p className="muted">Les types désactivés restent visibles dans les historiques existants, mais ne peuvent plus être utilisés pour de nouvelles interventions. Les règles s'appliquent au niveau de cette entreprise.</p>
        <button className="button primary">Enregistrer la configuration</button>
      </form></FormDialog>
    </section>
  </>;
}
