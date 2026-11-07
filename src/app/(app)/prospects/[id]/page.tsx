import { notFound, redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import {
  recordProspectIntervention,
  changeProspectInterventionStatus,
  reviewProspectIntervention,
} from "@/server/actions/commissions";

const typeLabels: Record<string,string> = {
  recommendation:"Recommandation", prospecting:"Prospection", contact:"Prise de contact",
  presentation:"Présentation", qualification:"Qualification", negotiation:"Négociation",
  transfer:"Transfert", closing:"Conclusion", signature:"Signature",
  follow_up:"Suivi", retention:"Fidélisation",
};
const roleLabels: Record<string,string> = {
  initiator:"Initiateur", recommender:"Recommandeur", prospector:"Prospecteur",
  qualifier:"Qualification", negotiator:"Négociateur", closer:"Concluant",
  account_manager:"Gestionnaire client", support:"Support",
};
const statusLabels: Record<string,string> = {
  not_started:"Non commencée", in_progress:"En cours", completed:"Terminée",
  transferred:"Transférée", cancelled:"Annulée", blocked:"Bloquée",
};

export default async function ProspectDetailPage({ params }: { params: Promise<{id:string}> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  const [canContribute, canReview, canAttributeForOthers] = await Promise.all([
    hasPermission(ctx,"commissions.contribute"),
    hasPermission(ctx,"commissions.policy.manage"),
    hasPermission(ctx,"commissions.audit"),
  ]);
  if (!canContribute && !canReview) redirect("/dashboard?access=denied");

  const [{data:prospect,error}, {data:interventions}, {data:members}, {data:types}] = await Promise.all([
    ctx.supabase.from("prospects").select("id,name,email,phone,source,status,created_at,converted_customer_id,current_owner_id")
      .eq("organization_id",ctx.organizationId).eq("id",id).maybeSingle(),
    ctx.supabase.from("prospect_interventions")
      .select("id,intervention_type,contribution_role,stage_status,validation_status,description,evidence_reference,contributor_user_id,created_by,department_snapshot,responsible_user_id,occurred_at,review_reason")
      .eq("organization_id",ctx.organizationId).eq("prospect_id",id).order("occurred_at",{ascending:false}),
    ctx.supabase.from("organization_members").select("user_id,department")
      .eq("organization_id",ctx.organizationId).eq("status","active"),
    ctx.supabase.from("prospect_intervention_type_settings").select("intervention_type,label,is_active,requires_evidence")
      .eq("organization_id",ctx.organizationId).eq("is_active",true).order("sort_order"),
  ]);
  if (error || !prospect) notFound();
  const userIds = [...new Set([...(members||[]).map((m:any)=>m.user_id),...(interventions||[]).flatMap((i:any)=>[i.contributor_user_id,i.created_by,i.responsible_user_id].filter(Boolean))])];
  const {data:profiles=[]} = userIds.length
    ? await ctx.supabase.from("profiles").select("id,email").in("id",userIds)
    : {data:[] as any[]};
  const emailById = new Map((profiles||[]).map((p:any)=>[p.id,p.email]));
  const {data:history=[]} = await ctx.supabase.from("prospect_intervention_history")
    .select("id,intervention_id,action,actor_user_id,previous_value,new_value,justification,created_at")
    .eq("organization_id",ctx.organizationId)
    .in("intervention_id",(interventions||[]).map((i:any)=>i.id).length ? (interventions||[]).map((i:any)=>i.id) : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at",{ascending:false});

  return <>
    <div className="pageHead">
      <div><p className="eyebrow">CRM · Historique collaboratif</p><h1>{prospect.name}</h1>
        <p>{prospect.email||"Sans e-mail"} · {prospect.phone||"Sans téléphone"} · {prospect.source||"Origine non précisée"}</p>
        <p>Statut : <strong>{prospect.status}</strong> · Créé le {new Date(prospect.created_at).toLocaleString("fr-FR")}</p>
      </div><a className="button" href="/prospects">Retour aux prospects</a>
    </div>
    <section className="card section">
      <h2>Enregistrer une intervention</h2>
      {canContribute ? <form action={recordProspectIntervention} className="form">
        <input type="hidden" name="prospect_id" value={id}/>
        <div className="grid">
          <div className="field"><label>Type</label><select name="intervention_type" required>{(types||[]).map((t:any)=><option key={t.intervention_type} value={t.intervention_type}>{t.label}</option>)}</select></div>
          <div className="field"><label>Rôle du collaborateur</label><select name="contribution_role" required>
            {Object.entries(roleLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select></div>
          <div className="field"><label>État de l'étape</label><select name="stage_status" defaultValue="in_progress">
            <option value="not_started">Non commencée</option><option value="in_progress">En cours</option><option value="completed">Terminée</option><option value="blocked">Bloquée</option><option value="cancelled">Annulée</option>
          </select></div>
          <div className="field"><label>Preuve / référence justificative</label><input name="evidence_reference" maxLength={500} placeholder="Lien, référence de document, compte rendu…"/></div>
          {canReview || canAttributeForOthers ? <div className="field"><label>Collaborateur concerné (recommandation pour un tiers)</label><select name="contributor_user_id" defaultValue=""><option value="">Moi-même</option>
            {(members||[]).map((m:any)=><option key={m.user_id} value={m.user_id}>{emailById.get(m.user_id)||m.user_id} {m.department? "· "+m.department:""}</option>)}
          </select></div> : null}
        </div>
        <div className="field"><label>Description de l'intervention</label><textarea name="description" rows={3} minLength={3} maxLength={2000} required/></div>
        <div className="field"><label>Nouveau responsable (uniquement pour un transfert)</label><select name="responsible_user_id" defaultValue=""><option value="">Aucun transfert</option>
          {(members||[]).map((m:any)=><option key={m.user_id} value={m.user_id}>{emailById.get(m.user_id)||m.user_id} {m.department? "· "+m.department:""}</option>)}
        </select></div>
        <button className="button primary">Enregistrer l'intervention</button>
      </form> : <p>Tu peux consulter l'historique, mais pas enregistrer d'intervention.</p>}
    </section>
    <section className="section">
      <h2>Contributions et étapes ({(interventions||[]).length})</h2>
      {!interventions?.length ? <EmptyState title="Aucune intervention" description="Les contributions enregistrées apparaîtront ici."/> :
      <div className="stack">{interventions.map((item:any)=><article className="card section" key={item.id}>
        <div className="pageHead"><div><h3>{typeLabels[item.intervention_type]||item.intervention_type}</h3>
          <p>{roleLabels[item.contribution_role]||item.contribution_role} · {emailById.get(item.contributor_user_id)||item.contributor_user_id}</p>
          <p>{item.department_snapshot||"Département non renseigné"} · {new Date(item.occurred_at).toLocaleString("fr-FR")}</p></div>
          <div><span className="badge">{statusLabels[item.stage_status]||item.stage_status}</span> <span className="badge">{item.validation_status}</span></div>
        </div>
        <p>{item.description}</p>
        {item.evidence_reference ? <p>Justificatif : {item.evidence_reference}</p> : <p className="muted">Aucun justificatif joint</p>}
        <p className="muted">Saisi par {emailById.get(item.created_by)||item.created_by}</p>
        {item.responsible_user_id ? <p>Responsable après transfert : {emailById.get(item.responsible_user_id)||item.responsible_user_id}</p> : null}
        {canReview && item.validation_status==="pending" ? <form action={reviewProspectIntervention} className="form">
          <input type="hidden" name="intervention_id" value={item.id}/><input type="hidden" name="prospect_id" value={id}/>
          <div className="field"><label>Justification de validation ou rejet</label><input name="reason" minLength={3} maxLength={1000} required/></div>
          <div className="actions"><button className="button primary" name="decision" value="validate">Valider la contribution</button><button className="button" name="decision" value="reject">Rejeter</button></div>
        </form> : null}
        {canContribute && !["transferred","cancelled"].includes(item.stage_status) ? <form action={changeProspectInterventionStatus} className="form">
          <input type="hidden" name="intervention_id" value={item.id}/><input type="hidden" name="prospect_id" value={id}/>
          <div className="field"><label>Changer le statut</label><select name="stage_status" defaultValue={item.stage_status}>
            {Object.entries(statusLabels).filter(([v])=>v!=="transferred").map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select></div>
          <div className="field"><label>Justification du changement</label><input name="reason" minLength={3} maxLength={1000} required/></div>
          <button className="button small">Historiser le changement</button>
        </form> : null}
        <details><summary>Historique des modifications ({history.filter((h:any)=>h.intervention_id===item.id).length})</summary>
          {(history.filter((h:any)=>h.intervention_id===item.id)).map((h:any)=><p key={h.id}>{new Date(h.created_at).toLocaleString("fr-FR")} · {h.action} · {emailById.get(h.actor_user_id)||h.actor_user_id} · {h.justification||"Sans motif"}</p>)}
        </details>
      </article>)}</div>}
    </section>
  </>;
}
