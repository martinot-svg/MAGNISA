import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { recordProspectIntervention, reviewProspectIntervention } from "@/server/actions/commissions";
const types = [["recommendation","Recommandation"],["contact","Prise de contact"],["presentation","Présentation"],["negotiation","Négociation"],["transfer","Transfert"],["signature","Signature"],["follow_up","Suivi"],["retention","Fidélisation"]];
const roles = [["recommender","Recommandeur"],["qualifier","Qualificateur"],["negotiator","Négociateur"],["closer","Concluant"],["account_manager","Responsable client"],["support","Contributeur"]];
export default async function ClientContributions({ params }: { params: Promise<{ id: string }> }) {
 const { id } = await params; const ctx = await requireOrganization();
 const [canView,canContribute,canReview] = await Promise.all([hasPermission(ctx,"billing.view"),hasPermission(ctx,"commissions.contribute"),hasPermission(ctx,"commissions.policy.manage")]);
 if (!canView && !canContribute) redirect("/dashboard?access=denied");
 const [{data:customer},{data:events=[],error},{data:members=[]}] = await Promise.all([
  ctx.supabase.from("customers").select("id,name").eq("organization_id",ctx.organizationId).eq("id",id).maybeSingle(),
  ctx.supabase.from("prospect_interventions").select("*").eq("organization_id",ctx.organizationId).eq("customer_id",id).order("occurred_at",{ascending:false}),
  ctx.supabase.from("organization_members").select("user_id,role,department").eq("organization_id",ctx.organizationId).eq("status","active")
 ]);
 if (!customer) notFound(); if (error) throw new Error("Impossible de charger les contributions client.");
 const ids=Array.from(new Set([...(members as any[]).map((x:any)=>x.user_id),...(events as any[]).flatMap((x:any)=>[x.contributor_user_id,x.created_by,x.reviewed_by].filter(Boolean))]));
 const {data:profiles=[]}=ids.length ? await ctx.supabase.from("profiles").select("id,email").in("id",ids) : {data:[] as any[]};
 const emails=new Map((profiles as any[]).map((x:any)=>[x.id,x.email])); const path="/clients/"+id+"/contributions";
 return <><div className="pageHead"><div><p className="eyebrow">Client · Journal collaboratif</p><h1>{customer.name}</h1><p>Interventions, transferts, validations et preuves associées au suivi client.</p></div><Link className="button" href={"/clients/"+id}>Retour à la fiche client</Link></div>
 {canContribute && <section className="section"><h2>Nouvelle intervention client</h2><form action={recordProspectIntervention} className="form card"><input type="hidden" name="customer_id" value={id}/>
 <div className="grid grid-3"><div className="field"><label>Collaborateur concerné</label><select name="contributor_user_id" required defaultValue=""><option value="" disabled>Choisir</option>{(members as any[]).map((m:any)=><option key={m.user_id} value={m.user_id}>{emails.get(m.user_id)||m.user_id} · {m.role}</option>)}</select></div>
 <div className="field"><label>Département</label><input name="department" maxLength={120}/></div><div className="field"><label>Type</label><select name="intervention_type">{types.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
 <div className="field"><label>Rôle</label><select name="contribution_role">{roles.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
 <div className="field"><label>Étape</label><select name="stage_status" defaultValue="in_progress"><option value="not_started">Non commencée</option><option value="in_progress">En cours</option><option value="completed">Terminée</option><option value="transferred">Transférée</option><option value="cancelled">Annulée</option><option value="blocked">Bloquée</option></select></div>
 <div className="field"><label>Nouveau responsable</label><select name="responsible_user_id" defaultValue=""><option value="">Aucun</option>{(members as any[]).map((m:any)=><option key={m.user_id} value={m.user_id}>{emails.get(m.user_id)||m.user_id}</option>)}</select></div>
 <div className="field"><label>Date et heure</label><input name="occurred_at" type="datetime-local"/></div><div className="field"><label>Justificatif</label><input name="evidence_reference" maxLength={1000}/></div></div>
 <div className="field"><label>Description</label><textarea name="description" required minLength={3} maxLength={4000}/></div><button className="button primary">Enregistrer</button></form></section>}
 <section className="section"><h2>Chronologie client</h2>{!(events as any[]).length ? <p className="muted">Aucune intervention.</p> : <div className="tableWrap"><table><thead><tr><th>Date</th><th>Collaborateur</th><th>Intervention</th><th>Étape</th><th>Validation</th><th>Décision</th></tr></thead><tbody>
 {(events as any[]).map((e:any)=><tr key={e.id}><td>{new Date(e.occurred_at).toLocaleString("fr-FR")}</td><td>{emails.get(e.contributor_user_id)||e.contributor_user_id}<div className="muted">Saisi par {emails.get(e.created_by)||e.created_by}</div></td><td><strong>{e.intervention_type}</strong><div>{e.description}</div>{e.evidence_reference && <div className="muted">{e.evidence_reference}</div>}</td><td>{e.stage_status}</td><td>{e.validation_status}</td><td>{canReview && e.validation_status==="pending" ? <div className="actions"><form action={reviewProspectIntervention}><input type="hidden" name="intervention_id" value={e.id}/><input type="hidden" name="decision" value="validate"/><input type="hidden" name="subject_path" value={path}/><input name="reason" required minLength={3} placeholder="Justification"/><button className="button small">Valider</button></form><form action={reviewProspectIntervention}><input type="hidden" name="intervention_id" value={e.id}/><input type="hidden" name="decision" value="reject"/><input type="hidden" name="subject_path" value={path}/><input name="reason" required minLength={3} placeholder="Motif"/><button className="button small">Rejeter</button></form></div> : (e.review_reason||"—")}</td></tr>)}</tbody></table></div>}</section></>;
}