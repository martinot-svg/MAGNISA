import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { changeProspectInterventionStatus, recordProspectIntervention, reviewProspectIntervention } from "@/server/actions/commissions";

const roleLabels: Record<string,string> = {
  initiator:"Initiateur", recommender:"Recommandeur", prospector:"Prospecteur",
  qualifier:"Qualificateur", negotiator:"Négociateur", closer:"Concluant",
  account_manager:"Responsable client", support:"Contributeur",
  originator:"Apporteur", closer_commission:"Concluant",
};
const statusLabels: Record<string,string> = {
  not_started:"Non commencée", in_progress:"En cours", completed:"Terminée",
  transferred:"Transférée", cancelled:"Annulée", blocked:"Bloquée",
};
const validationLabels: Record<string,string> = {
  pending:"En attente", validated:"Validée", rejected:"Rejetée",
};

export default async function ProspectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  const [canView, canContribute, canReview, canManage] = await Promise.all([
    hasPermission(ctx,"sales.view"),
    hasPermission(ctx,"commissions.contribute"),
    Promise.all([hasPermission(ctx,"commissions.policy.manage"),hasPermission(ctx,"commissions.audit")])
      .then(([manage,audit])=>manage||audit),
    hasPermission(ctx,"commissions.policy.manage"),
  ]);
  if (!canView && !canContribute && !canReview) redirect("/dashboard?access=denied");

  const [{data:prospect},{data:members=[],error:membersError},{data:interventionTypes=[],error:typesError}] = await Promise.all([
    ctx.supabase.from("prospects").select("*").eq("organization_id",ctx.organizationId).eq("id",id).maybeSingle(),
    ctx.supabase.rpc("list_collaboration_members",{p_org:ctx.organizationId}),
    ctx.supabase.rpc("list_prospect_intervention_types",{p_org:ctx.organizationId}),
  ]);
  if (!prospect) notFound();
  if (membersError || typesError) throw new Error("Impossible de charger le répertoire ou le catalogue des interventions.");
  const emailById = new Map((members as any[]).map((member:any)=>[member.user_id,member.email]));
  const typeLabelByKey = new Map((interventionTypes as any[]).map((item:any)=>[item.intervention_type,item.label]));

  let eventQuery = ctx.supabase.from("prospect_interventions").select("*")
    .eq("organization_id",ctx.organizationId).eq("prospect_id",id);
  if (prospect.converted_customer_id) {
    eventQuery = ctx.supabase.from("prospect_interventions").select("*")
      .eq("organization_id",ctx.organizationId)
      .or("prospect_id.eq."+id+",customer_id.eq."+prospect.converted_customer_id);
  }
  const {data:interventions=[],error} = await eventQuery.order("occurred_at",{ascending:false});
  if (error) throw new Error("Impossible de charger l'historique collaboratif.");
  const interventionIds = (interventions as any[]).map((item:any)=>item.id);
  const {data:history=[],error:historyError} = interventionIds.length
    ? await ctx.supabase.from("prospect_intervention_history").select("*")
      .eq("organization_id",ctx.organizationId).in("intervention_id",interventionIds)
      .order("created_at",{ascending:false})
    : {data:[] as any[],error:null};
  if (historyError) throw new Error("Impossible de charger l'historique des validations.");
  const {data:calculations=[],error:calculationsError} = await ctx.supabase.from("commission_calculations")
    .select("id,basis_amount,commission_total,currency,status,calculated_at")
    .eq("organization_id",ctx.organizationId).eq("prospect_id",id)
    .order("calculated_at",{ascending:false});
  if (calculationsError) throw new Error("Impossible de charger les calculs de commission.");
  const calculationIds=(calculations as any[]).map((item:any)=>item.id);
  const {data:allocations=[],error:allocationsError} = calculationIds.length
    ? await ctx.supabase.from("commission_allocations")
      .select("calculation_id,user_id,contribution_type,share_percentage,amount")
      .eq("organization_id",ctx.organizationId).in("calculation_id",calculationIds)
    : {data:[] as any[],error:null};
  if (allocationsError) throw new Error("Impossible de charger les répartitions de commission.");
  const path = "/prospects/"+id;

  return <>
    <div className="pageHead">
      <div>
        <p className="eyebrow">Dossier commercial · Prospect</p>
        <h1>{prospect.name}</h1>
        <p>{prospect.email || "Sans e-mail"} · {prospect.phone || "Sans téléphone"} · Source : {prospect.source || "Non renseignée"} · Responsable actuel : {prospect.current_owner_id ? (emailById.get(prospect.current_owner_id) || prospect.current_owner_id) : "Non attribué"}</p>
      </div>
      <div className="actions"><Link className="button" href="/prospects">Retour aux prospects</Link></div>
    </div>

    <div className="grid grid-3">
      <div className="card"><div className="muted">Statut commercial</div><strong className="metric">{prospect.status}</strong></div>
      <div className="card"><div className="muted">Collaborateurs impliqués</div><strong className="metric">{new Set((interventions as any[]).map((item:any)=>item.contributor_user_id)).size}</strong></div>
      <div className="card"><div className="muted">Contributions validées</div><strong className="metric">{(interventions as any[]).filter((item:any)=>item.validation_status==="validated").length}</strong></div>
    </div>

    {canContribute && <section className="section">
      <h2>Enregistrer une intervention</h2>
      <p className="muted">Un collaborateur ordinaire ne peut déclarer que sa propre intervention. Une déclaration faite par un responsable au nom d'un collègue reste soumise à validation indépendante.</p>
      <form action={recordProspectIntervention} className="form card">
        <input type="hidden" name="prospect_id" value={id}/>
        <div className="grid grid-3">
          <div className="field"><label>Collaborateur ayant contribué</label><select name="contributor_user_id" required defaultValue="">
            <option value="" disabled>Choisir</option>
            {(members as any[]).filter((member:any)=>member.status==="active").map((member:any)=><option key={member.user_id} value={member.user_id}>{member.email || member.user_id} · {member.department || member.role}</option>)}
          </select></div>
          <div className="field"><label>Type d'intervention</label><select name="intervention_type" defaultValue={(interventionTypes as any[]).find((item:any)=>item.is_active)?.intervention_type || ""}>
            {(interventionTypes as any[]).filter((item:any)=>item.is_active).map((item:any)=><option key={item.intervention_type} value={item.intervention_type}>{item.label}{item.requires_evidence?" · preuve requise":""}</option>)}
          </select></div>
          <div className="field"><label>Rôle dans l'opportunité</label><select name="contribution_role" defaultValue="qualifier">
            {Object.entries(roleLabels).filter(([key])=>!["originator","closer_commission"].includes(key)).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select></div>
          <div className="field"><label>État de l'étape</label><select name="stage_status" defaultValue="in_progress">
            {Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select></div>
          <div className="field"><label>Date et heure de l'intervention</label><input name="occurred_at" type="datetime-local"/></div>
          <div className="field"><label>Preuve / justificatif (lien ou référence)</label><input name="evidence_reference" maxLength={1000} placeholder="Référence document, contrat, e-mail…"/></div>
          <div className="field"><label>Nouveau responsable (transfert)</label><select name="responsible_user_id" defaultValue="">
            <option value="">Aucun transfert</option>
            {(members as any[]).filter((member:any)=>member.status==="active").map((member:any)=><option key={member.user_id} value={member.user_id}>{member.email || member.user_id} · {member.role}</option>)}
          </select></div>
        </div>
        <div className="field"><label>Description détaillée</label><textarea name="description" rows={3} minLength={3} maxLength={4000} required/></div>
        <button className="button primary">Enregistrer l'intervention</button>
      </form>
    </section>}

    <section className="section">
      <h2>Chronologie complète des contributions</h2>
      {(interventions as any[]).length===0 ? <div className="card muted">Aucune intervention enregistrée pour ce prospect.</div> :
      <div className="tableWrap"><table><thead><tr><th>Date</th><th>Collaborateur / rôle</th><th>Intervention</th><th>Étape et suivi</th><th>Validation</th><th>Preuve et auteur</th><th>Décision</th></tr></thead><tbody>
        {(interventions as any[]).map((item:any)=><tr key={item.id}>
          <td>{new Date(item.occurred_at).toLocaleString("fr-FR")}</td>
          <td><strong>{emailById.get(item.contributor_user_id) || item.contributor_user_id}</strong><div className="muted">{roleLabels[item.contribution_role] || item.contribution_role} · {item.department_snapshot || "Département non renseigné"}</div></td>
          <td><strong>{typeLabelByKey.get(item.intervention_type) || item.intervention_type}</strong><div>{item.description}</div></td>
          <td>{statusLabels[item.stage_status] || item.stage_status}
            {(canContribute || canManage) && item.intervention_type!=="transfer" && item.stage_status!=="transferred" &&
              (canManage || item.contributor_user_id===ctx.user.id || item.created_by===ctx.user.id) &&
              <form action={changeProspectInterventionStatus} className="form">
                <input type="hidden" name="intervention_id" value={item.id}/>
                <input type="hidden" name="subject_path" value={path}/>
                <select name="stage_status" defaultValue={item.stage_status}>
                  {Object.entries(statusLabels).filter(([key])=>key!=="transferred").map(([value,label])=><option key={value} value={value}>{label}</option>)}
                </select>
                <input name="reason" required minLength={3} maxLength={1000} placeholder="Justification du changement"/>
                <button className="button small">Mettre à jour</button>
              </form>}
          </td>
          <td><span className="badge">{validationLabels[item.validation_status] || item.validation_status}</span>{item.review_reason && <div className="muted">{item.review_reason}</div>}</td>
          <td>{item.evidence_reference || "—"}<div className="muted">Saisi par {emailById.get(item.created_by) || item.created_by}</div></td>
          <td>{canReview && item.validation_status==="pending" && item.contributor_user_id!==ctx.user.id ? <div className="actions">
            <form action={reviewProspectIntervention}><input type="hidden" name="intervention_id" value={item.id}/><input type="hidden" name="decision" value="validate"/><input type="hidden" name="subject_path" value={path}/><input name="reason" required minLength={3} placeholder="Justification"/><button className="button small">Valider</button></form>
            <form action={reviewProspectIntervention}><input type="hidden" name="intervention_id" value={item.id}/><input type="hidden" name="decision" value="reject"/><input type="hidden" name="subject_path" value={path}/><input name="reason" required minLength={3} placeholder="Motif du rejet"/><button className="button small">Rejeter</button></form>
          </div> : item.reviewed_by ? <span className="muted">Décidé par {emailById.get(item.reviewed_by) || item.reviewed_by}</span> : "—"}</td>
        </tr>)}
      </tbody></table></div>}
    </section>

    <section className="section">
      <h2>Historique des modifications</h2>
      {!(history as any[]).length ? <p className="muted">Aucun changement historisé.</p> :
      <div className="tableWrap"><table><thead><tr><th>Date</th><th>Action</th><th>Auteur</th><th>Justification</th><th>Données</th></tr></thead><tbody>
        {(history as any[]).map((item:any)=><tr key={item.id}><td>{new Date(item.created_at).toLocaleString("fr-FR")}</td><td>{item.action}</td><td>{emailById.get(item.actor_user_id)||item.actor_user_id}</td><td>{item.justification||"—"}</td><td><code>{JSON.stringify(item.new_value)}</code></td></tr>)}
      </tbody></table></div>}
      <p className="muted">Les commissions sont alimentées uniquement par les contributions validées et éligibles à un rôle de commission.</p>
    </section>

    <section className="section">
      <h2>Commissions et répartition</h2>
      {!(calculations as any[]).length ? <p className="muted">Aucun calcul de commission associé à ce prospect.</p> :
      (calculations as any[]).map((calculation:any)=><div className="card section" key={calculation.id}>
        <div className="actions"><strong>{calculation.status}</strong><span>{calculation.commission_total} {calculation.currency}</span></div>
        <p className="muted">Base : {calculation.basis_amount} {calculation.currency} · Calcul : {new Date(calculation.calculated_at).toLocaleString("fr-FR")}</p>
        <div className="tableWrap"><table><thead><tr><th>Collaborateur</th><th>Contribution</th><th>Part</th><th>Commission</th></tr></thead><tbody>
          {(allocations as any[]).filter((allocation:any)=>allocation.calculation_id===calculation.id).map((allocation:any)=><tr key={allocation.calculation_id+allocation.user_id+allocation.contribution_type}>
            <td>{emailById.get(allocation.user_id)||allocation.user_id}</td><td>{roleLabels[allocation.contribution_type]||allocation.contribution_type}</td><td>{allocation.share_percentage}%</td><td>{allocation.amount} {calculation.currency}</td>
          </tr>)}
        </tbody></table></div>
      </div>)}
    </section>
  </>;
}
