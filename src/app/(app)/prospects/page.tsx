import { redirect } from "next/navigation";
import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { convertProspectToCustomer, createProspect } from "@/server/actions/commissions";

export default async function ProspectsPage({ searchParams }: { searchParams: Promise<{ conversion?: string }> }) {
  const params = await searchParams;
  const ctx = await requireOrganization();
  const [canViewSales,canContribute,canConvert,canManageCollaborativeSettings] = await Promise.all([
    hasPermission(ctx,"sales.view"),
    hasPermission(ctx,"commissions.contribute"),
    hasPermission(ctx,"prospects.convert"),
    hasPermission(ctx,"commissions.policy.manage"),
  ]);
  if (!canViewSales && !canContribute) redirect("/dashboard?access=denied");

  const [{data:prospects=[],error},{data:members=[],error:membersError}] = await Promise.all([
    ctx.supabase.from("prospects")
      .select("id,name,email,phone,source,status,converted_customer_id,created_at")
      .eq("organization_id",ctx.organizationId).order("created_at",{ascending:false}),
    ctx.supabase.rpc("list_collaboration_members",{p_org:ctx.organizationId}),
  ]);
  if (error) throw new Error("Impossible de charger les prospects.");
  if (membersError) throw new Error("Impossible de charger le répertoire des collaborateurs.");

  return <>
    <div className="pageHead">
      <div><h1>Prospects</h1><p>Suivi des opportunités, des collaborateurs impliqués et des conversions clients.</p></div>
      <div className="actions">
        {canManageCollaborativeSettings && <Link className="button" href="/prospects/settings">Configurer les interventions</Link>}
        {canContribute && <FormDialog title="Nouveau prospect" buttonLabel="+ Nouveau prospect">
          <form action={createProspect} className="form">
            <div className="field"><label>Nom / raison sociale</label><input name="name" minLength={2} maxLength={180} required/></div>
            <div className="field"><label>E-mail</label><input name="email" type="email" maxLength={254}/></div>
            <div className="field"><label>Téléphone</label><input name="phone" maxLength={40}/></div>
            <div className="field"><label>Source</label><input name="source" maxLength={120} placeholder="Recommandation, appel, visite…"/></div>
            <div className="field"><label>Recommandé par un collaborateur (facultatif)</label>
              <select name="referrer_user_id" defaultValue=""><option value="">Aucune recommandation déclarée</option>
                {(members as any[]).filter((member:any)=>member.status==="active" && member.user_id!==ctx.user.id)
                  .map((member:any)=><option key={member.user_id} value={member.user_id}>{member.email||member.user_id} · {member.department||member.role}</option>)}
              </select>
              <small className="muted">La recommandation est enregistrée séparément et reste en attente de validation.</small>
            </div>
            <div className="field"><label>Justificatif de recommandation (facultatif ou obligatoire selon la configuration)</label><input name="referrer_evidence_reference" maxLength={1000} placeholder="Référence e-mail, document ou contrat"/></div>
            <div className="field"><label>Notes</label><textarea name="notes" rows={3} maxLength={2000}/></div>
            <button className="button primary">Créer le prospect</button>
          </form>
        </FormDialog>}
      </div>
    </div>
    {params.conversion === "duplicate" && <p role="alert" className="muted">Conversion impossible : un client actif possède déjà cet e-mail ou ce numéro. Vérifie le client existant avant de poursuivre.</p>}
    <div className="section">
      {!prospects.length ? <EmptyState title="Aucun prospect" description="Crée un prospect réel pour démarrer le suivi commercial."/> :
      <div className="tableWrap"><table><thead><tr><th>Prospect</th><th>Statut</th><th>Contact</th><th>Source</th><th>Conversion</th><th>Action</th></tr></thead><tbody>
        {(prospects as any[]).map((prospect:any)=><tr key={prospect.id}>
          <td><strong><Link href={"/prospects/"+prospect.id}>{prospect.name}</Link></strong><div className="muted">{new Date(prospect.created_at).toLocaleDateString("fr-FR")}</div></td>
          <td><span className="badge">{prospect.status}</span></td><td>{prospect.email||"—"}<div className="muted">{prospect.phone||""}</div></td>
          <td>{prospect.source||"—"}</td><td>{prospect.converted_customer_id?<span className="badge">Client créé</span>:"Non converti"}</td>
          <td>{canConvert&&!prospect.converted_customer_id&&prospect.status!=="lost"?
            <form action={convertProspectToCustomer}><input type="hidden" name="prospect_id" value={prospect.id}/><button className="button small">Clôturer comme gagné</button></form>:
            prospect.converted_customer_id?"Déjà converti":"—"}</td>
        </tr>)}
      </tbody></table></div>}
    </div>
  </>;
}
