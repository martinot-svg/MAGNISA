import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { changeProspectInterventionStatus, recordProspectIntervention, reviewProspectIntervention } from "@/server/actions/commissions";

const roles = [
  ["initiator","Initiateur"],["recommender","Recommandeur"],["prospector","Prospecteur"],
  ["qualifier","Qualificateur"],["negotiator","Négociateur"],["closer","Concluant"],
  ["account_manager","Responsable client"],["support","Contributeur"],
];
const statuses = [
  ["not_started","Non commencée"],["in_progress","En cours"],["completed","Terminée"],
  ["transferred","Transférée"],["cancelled","Annulée"],["blocked","Bloquée"],
];

export default async function ClientContributions({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  const [canView,canContribute,canReview,canManage] = await Promise.all([
    hasPermission(ctx,"billing.view"),
    hasPermission(ctx,"commissions.contribute"),
    Promise.all([hasPermission(ctx,"commissions.policy.manage"),hasPermission(ctx,"commissions.audit")])
      .then(([manage,audit])=>manage||audit),
    hasPermission(ctx,"commissions.policy.manage"),
  ]);
  if (!canView && !canContribute && !canReview) redirect("/dashboard?access=denied");

  const [{data:customer},{data:originatingProspect},{data:members=[],error:membersError},{data:interventionTypes=[],error:typesError}] = await Promise.all([
    ctx.supabase.from("customers").select("id,name").eq("organization_id",ctx.organizationId).eq("id",id).maybeSingle(),
    ctx.supabase.from("prospects").select("id").eq("organization_id",ctx.organizationId).eq("converted_customer_id",id).maybeSingle(),
    ctx.supabase.rpc("list_collaboration_members",{p_org:ctx.organizationId}),
    ctx.supabase.rpc("list_prospect_intervention_types",{p_org:ctx.organizationId}),
  ]);
  if (!customer) notFound();
  if (membersError || typesError) throw new Error("Impossible de charger le répertoire ou le catalogue des interventions.");
  let eventQuery = ctx.supabase.from("prospect_interventions").select("*")
    .eq("organization_id",ctx.organizationId).eq("customer_id",id);
  if (originatingProspect) {
    eventQuery = ctx.supabase.from("prospect_interventions").select("*")
      .eq("organization_id",ctx.organizationId)
      .or("customer_id.eq."+id+",prospect_id.eq."+originatingProspect.id);
  }
  const {data:events=[],error} = await eventQuery.order("occurred_at",{ascending:false});
  if (error) throw new Error("Impossible de charger les contributions client.");
  const emailById = new Map((members as any[]).map((member:any)=>[member.user_id,member.email]));
  const typeLabelByKey = new Map((interventionTypes as any[]).map((item:any)=>[item.intervention_type,item.label]));
  const eventIds=(events as any[]).map((item:any)=>item.id);
  const {data:history=[],error:historyError}=eventIds.length
    ? await ctx.supabase.from("prospect_intervention_history").select("*")
      .eq("organization_id",ctx.organizationId).in("intervention_id",eventIds)
      .order("created_at",{ascending:false})
    : {data:[] as any[],error:null};
  if (historyError) throw new Error("Impossible de charger l'historique des interventions.");
  const path="/clients/"+id+"/contributions";

  return <>
    <div className="pageHead">
      <div><p className="eyebrow">Client · Journal collaboratif</p><h1>{customer.name}</h1>
        <p>Interventions, transferts, validations et preuves associées au suivi client.</p></div>
      <Link className="button" href={"/clients/"+id}>Retour à la fiche client</Link>
    </div>
    {canContribute && <section className="section">
      <h2>Nouvelle intervention client</h2>
      <p className="muted">Les interventions sont historisées. Les déclarations restent en attente jusqu'à leur validation indépendante.</p>
      <form action={recordProspectIntervention} className="form card">
        <input type="hidden" name="customer_id" value={id}/>
        <div className="grid grid-3">
          <div className="field"><label>Collaborateur concerné</label><select name="contributor_user_id" required defaultValue="">
            <option value="" disabled>Choisir</option>
            {(members as any[]).filter((member:any)=>member.status==="active").map((member:any)=><option key={member.user_id} value={member.user_id}>{member.email||member.user_id} · {member.department||member.role}</option>)}
          </select></div>
          <div className="field"><label>Type</label><select name="intervention_type" defaultValue={(interventionTypes as any[]).find((item:any)=>item.is_active)?.intervention_type||""}>
            {(interventionTypes as any[]).filter((item:any)=>item.is_active).map((item:any)=><option key={item.intervention_type} value={item.intervention_type}>{item.label}{item.requires_evidence?" · preuve requise":""}</option>)}
          </select></div>
          <div className="field"><label>Rôle</label><select name="contribution_role" defaultValue="account_manager">
            {roles.map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select></div>
          <div className="field"><label>Étape</label><select name="stage_status" defaultValue="in_progress">
            {statuses.map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select></div>
          <div className="field"><label>Nouveau responsable (transfert)</label><select name="responsible_user_id" defaultValue="">
            <option value="">Aucun transfert</option>
            {(members as any[]).filter((member:any)=>member.status==="active").map((member:any)=><option key={member.user_id} value={member.user_id}>{member.email||member.user_id} · {member.role}</option>)}
          </select></div>
          <div className="field"><label>Date et heure</label><input name="occurred_at" type="datetime-local"/></div>
          <div className="field"><label>Justificatif</label><input name="evidence_reference" maxLength={1000} placeholder="Lien ou référence de pièce"/></div>
        </div>
        <div className="field"><label>Description</label><textarea name="description" required minLength={3} maxLength={4000}/></div>
        <button className="button primary">Enregistrer l'intervention</button>
      </form>
    </section>}
    <section className="section">
      <h2>Chronologie client</h2>
      {!(events as any[]).length ? <p className="muted">Aucune intervention.</p> :
      <div className="tableWrap"><table><thead><tr><th>Date</th><th>Collaborateur</th><th>Intervention</th><th>Étape et suivi</th><th>Validation</th><th>Décision</th></tr></thead><tbody>
        {(events as any[]).map((item:any)=><tr key={item.id}>
          <td>{new Date(item.occurred_at).toLocaleString("fr-FR")}</td>
          <td>{emailById.get(item.contributor_user_id)||item.contributor_user_id}<div className="muted">Saisi par {emailById.get(item.created_by)||item.created_by}</div></td>
          <td><strong>{typeLabelByKey.get(item.intervention_type)||item.intervention_type}</strong><div>{item.description}</div>{item.evidence_reference&&<div className="muted">{item.evidence_reference}</div>}</td>
          <td>{item.stage_status}
            {canContribute && item.intervention_type!=="transfer" && item.stage_status!=="transferred" &&
              (canManage || item.contributor_user_id===ctx.user.id || item.created_by===ctx.user.id) &&
              <form action={changeProspectInterventionStatus} className="form">
                <input type="hidden" name="intervention_id" value={item.id}/>
                <input type="hidden" name="subject_path" value={path}/>
                <select name="stage_status" defaultValue={item.stage_status}>
                  {statuses.filter(([key])=>key!=="transferred").map(([value,label])=><option key={value} value={value}>{label}</option>)}
                </select>
                <input name="reason" required minLength={3} maxLength={1000} placeholder="Justification du changement"/>
                <button className="button small">Mettre à jour</button>
              </form>}
          </td><td>{item.validation_status}</td>
          <td>{canReview && item.validation_status==="pending" ? <div className="actions">
            <form action={reviewProspectIntervention}><input type="hidden" name="intervention_id" value={item.id}/><input type="hidden" name="decision" value="validate"/><input type="hidden" name="subject_path" value={path}/><input name="reason" required minLength={3} placeholder="Justification"/><button className="button small">Valider</button></form>
            <form action={reviewProspectIntervention}><input type="hidden" name="intervention_id" value={item.id}/><input type="hidden" name="decision" value="reject"/><input type="hidden" name="subject_path" value={path}/><input name="reason" required minLength={3} placeholder="Motif du rejet"/><button className="button small">Rejeter</button></form>
          </div> : (item.review_reason||"—")}</td>
        </tr>)}
      </tbody></table></div>}
      <h3>Historique des modifications</h3>
      {!(history as any[]).length ? <p className="muted">Aucun changement historisé.</p> :
      <div className="tableWrap"><table><thead><tr><th>Date</th><th>Action</th><th>Auteur</th><th>Justification</th><th>Données</th></tr></thead><tbody>
        {(history as any[]).map((item:any)=><tr key={item.id}><td>{new Date(item.created_at).toLocaleString("fr-FR")}</td><td>{item.action}</td><td>{emailById.get(item.actor_user_id)||item.actor_user_id}</td><td>{item.justification||"—"}</td><td><code>{JSON.stringify(item.new_value)}</code></td></tr>)}
      </tbody></table></div>}
    </section>
  </>;
}
