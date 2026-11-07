import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { recordProspectIntervention, reviewProspectIntervention } from "@/server/actions/commissions";

const typeLabels: Record<string,string> = {
  recommendation:"Recommandation", prospecting:"Prospection", contact:"Prise de contact",
  presentation:"Présentation", qualification:"Qualification", negotiation:"Négociation",
  transfer:"Transfert", closing:"Conclusion", signature:"Signature",
  follow_up:"Suivi", retention:"Fidélisation",
};
const roleLabels: Record<string,string> = {
  initiator:"Initiateur", recommender:"Recommandeur", prospector:"Prospecteur",
  qualifier:"Qualificateur", negotiator:"Négociateur", closer:"Concluant",
  account_manager:"Responsable client", support:"Contributeur",
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
  const [canView, canContribute, canReview] = await Promise.all([
    hasPermission(ctx,"sales.view"),
    hasPermission(ctx,"commissions.contribute"),
    hasPermission(ctx,"commissions.policy.manage"),
  ]);
  if (!canView && !canContribute) redirect("/dashboard?access=denied");

  const [{data:prospect},{data:members=[]}] = await Promise.all([
    ctx.supabase.from("prospects").select("*").eq("organization_id",ctx.organizationId).eq("id",id).maybeSingle(),
    ctx.supabase.from("organization_members").select("user_id,role,department").eq("organization_id",ctx.organizationId).eq("status","active"),
  ]);
  if (!prospect) notFound();
  let eventQuery = ctx.supabase.from("prospect_interventions").select("*").eq("organization_id",ctx.organizationId).eq("prospect_id",id);
  if (prospect.converted_customer_id) eventQuery = ctx.supabase.from("prospect_interventions").select("*").eq("organization_id",ctx.organizationId).or("prospect_id.eq."+id+",customer_id.eq."+prospect.converted_customer_id);
  const {data:interventions=[],error} = await eventQuery.order("occurred_at",{ascending:false});
  if (error) throw new Error("Impossible de charger l'historique collaboratif.");
  const ids = Array.from(new Set([...(members as any[]).map((m:any)=>m.user_id), prospect.current_owner_id, ...(interventions as any[]).flatMap((x:any)=>[x.contributor_user_id,x.created_by,x.responsible_user_id,x.reviewed_by].filter(Boolean))]));
  const {data:profiles=[]} = ids.length
    ? await ctx.supabase.from("profiles").select("id,email").in("id",ids)
    : {data:[] as any[]};
  const emailById = new Map((profiles as any[]).map((p:any)=>[p.id,p.email]));
  const path = `/prospects/${id}`;

  return <>
    <div className="pageHead">
      <div><p className="eyebrow">Dossier commercial · Prospect</p><h1>{prospect.name}</h1>
        <p>{prospect.email || "Sans e-mail"} · {prospect.phone || "Sans téléphone"} · Source : {prospect.source || "Non renseignée"} · Responsable actuel : {prospect.current_owner_id ? (emailById.get(prospect.current_owner_id) || prospect.current_owner_id) : "Non attribué"}</p></div>
      <div className="actions"><Link className="button" href="/prospects">Retour aux prospects</Link></div>
    </div>
    <div className="grid grid-3">
      <div className="card"><div className="muted">Statut commercial</div><strong className="metric">{prospect.status}</strong></div>
      <div className="card"><div className="muted">Collaborateurs impliqués</div><strong className="metric">{new Set((interventions as any[]).map((x:any)=>x.contributor_user_id)).size}</strong></div>
      <div className="card"><div className="muted">Contributions validées</div><strong className="metric">{(interventions as any[]).filter((x:any)=>x.validation_status==="validated").length}</strong></div>
    </div>

    {canContribute && <section className="section">
      <h2>Enregistrer une intervention</h2>
      <p className="muted">Le collaborateur qui a réellement contribué doit être sélectionné. L'auteur de la saisie est enregistré séparément. Toute nouvelle contribution reste en attente de validation.</p>
      <form action={recordProspectIntervention} className="form card">
        <input type="hidden" name="prospect_id" value={id}/>
        <div className="grid grid-3">
          <div className="field"><label>Collaborateur ayant contribué</label><select name="contributor_user_id" required defaultValue=""><option value="" disabled>Choisir</option>{(members as any[]).map((m:any)=><option key={m.user_id} value={m.user_id}>{emailById.get(m.user_id) || m.user_id} · {m.role}</option>)}</select></div>
          <div className="field"><label>Département</label><input name="department" maxLength={120} placeholder="Département (facultatif)"/></div>
          <div className="field"><label>Type d'intervention</label><select name="intervention_type" defaultValue="contact">{Object.entries(typeLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
          <div className="field"><label>Rôle dans l'opportunité</label><select name="contribution_role" defaultValue="qualifier">{Object.entries(roleLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
          <div className="field"><label>État de l'étape</label><select name="stage_status" defaultValue="in_progress">{Object.entries(statusLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
          <div className="field"><label>Date et heure de l'intervention</label><input name="occurred_at" type="datetime-local"/></div>
          <div className="field"><label>Preuve / justificatif (lien ou référence)</label><input name="evidence_reference" maxLength={1000} placeholder="Référence document, contrat, e-mail…"/></div>
          <div className="field"><label>Nouveau responsable (transfert)</label><select name="responsible_user_id" defaultValue=""><option value="">Aucun transfert</option>{(members as any[]).map((m:any)=><option key={m.user_id} value={m.user_id}>{emailById.get(m.user_id) || m.user_id} · {m.role}</option>)}</select></div>
        </div>
        <div className="field"><label>Description détaillée</label><textarea name="description" rows={3} minLength={3} maxLength={4000} required/></div>
        <button className="button primary">Enregistrer l'intervention</button>
      </form>
    </section>}

    <section className="section">
      <h2>Chronologie complète des contributions</h2>
      {(interventions as any[]).length===0 ? <div className="card muted">Aucune intervention enregistrée pour ce prospect.</div> :
      <div className="tableWrap"><table><thead><tr><th>Date</th><th>Collaborateur / rôle</th><th>Intervention</th><th>Étape</th><th>Validation</th><th>Preuve et auteur</th><th>Décision</th></tr></thead><tbody>
        {(interventions as any[]).map((item:any)=><tr key={item.id}>
          <td>{new Date(item.occurred_at).toLocaleString("fr-FR")}</td>
          <td><strong>{emailById.get(item.contributor_user_id) || item.contributor_user_id}</strong><div className="muted">{roleLabels[item.contribution_role]} · {item.department_snapshot || "Département non renseigné"}</div></td>
          <td><strong>{typeLabels[item.intervention_type]}</strong><div>{item.description}</div></td>
          <td>{statusLabels[item.stage_status]}</td>
          <td><span className="badge">{validationLabels[item.validation_status]}</span>{item.review_reason && <div className="muted">{item.review_reason}</div>}</td>
          <td>{item.evidence_reference ? <span>{item.evidence_reference}</span> : "—"}<div className="muted">Saisi par {emailById.get(item.created_by) || item.created_by}</div></td>
          <td>{canReview && item.validation_status==="pending" ? <div className="actions">
            <form action={reviewProspectIntervention}><input type="hidden" name="intervention_id" value={item.id}/><input type="hidden" name="decision" value="validate"/><input type="hidden" name="subject_path" value={path}/><input name="reason" required minLength={3} placeholder="Justification" className="input"/><button className="button small">Valider</button></form>
            <form action={reviewProspectIntervention}><input type="hidden" name="intervention_id" value={item.id}/><input type="hidden" name="decision" value="reject"/><input type="hidden" name="subject_path" value={path}/><input name="reason" required minLength={3} placeholder="Motif du rejet" className="input"/><button className="button small">Rejeter</button></form>
          </div> : item.reviewed_by ? <span className="muted">Décidé par {emailById.get(item.reviewed_by) || item.reviewed_by}</span> : "—"}</td>
        </tr>)}
      </tbody></table></div>}
    </section>
    <section className="section"><h2>Historique des modifications</h2><p className="muted">Les décisions de validation et transferts sont conservés dans le journal append-only en base. Les commissions sont alimentées uniquement par les contributions validées et éligibles à un rôle de commission.</p></section>
  </>;
}
