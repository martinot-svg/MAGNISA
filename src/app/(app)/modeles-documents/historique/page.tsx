import {revalidatePath} from "next/cache";
import Link from "next/link";
import {requireOrganization} from "@/lib/current-org";
import {assertPermission} from "@/lib/permissions";
import {assertDocumentAction} from "@/lib/document-permissions";
import {transitionTemplateStatus,type TemplateAction,type TemplateStatus} from "@/lib/template-lifecycle";

async function updateTemplate(form:FormData){
 "use server";
 const ctx=await requireOrganization();
 await assertPermission(ctx,"settings.manage");
 if(!["owner","admin"].includes(ctx.role))throw new Error("Administrateur de l'entreprise requis.");
 const id=String(form.get("template_id")||"");
 const action=String(form.get("action")||"") as TemplateAction;
 if(!["submit_review","publish","archive","restore_draft"].includes(action))throw new Error("Action inconnue");
 if(form.get("confirmed")!=="yes")throw new Error("Confirmation requise.");
 const {data:tpl,error}=await ctx.supabase.from("document_templates").select("id,document_type,lifecycle_status,is_default").eq("organization_id",ctx.organizationId).eq("id",id).single();
 if(error||!tpl)throw new Error("Modèle inaccessible.");
 const scope=tpl.document_type as "quote"|"invoice"|"payslip"|"report";
 await assertDocumentAction(ctx,action==="archive"?"templates.archive":action==="publish"?"templates.publish":"templates.edit_shared",scope);
 if(action==="archive"&&tpl.is_default)throw new Error("Sélectionnez d'abord un autre modèle par défaut avant d'archiver le modèle actif.");
 const next=transitionTemplateStatus(tpl.lifecycle_status as TemplateStatus,action);
 const {error:writeError}=await ctx.supabase.from("document_templates").update({lifecycle_status:next,archived_at:next==="archived"?new Date().toISOString():null}).eq("organization_id",ctx.organizationId).eq("id",id);
 if(writeError)throw new Error(writeError.message);
 revalidatePath("/modeles-documents/historique");revalidatePath("/bibliotheque-documents");
}
async function restoreTemplateVersion(form:FormData){
 "use server";
 const ctx=await requireOrganization();
 await assertPermission(ctx,"settings.manage");
 if(!["owner","admin"].includes(ctx.role))throw new Error("Administrateur requis.");
 if(form.get("confirmed")!=="yes")throw new Error("Confirmer la restauration.");
 const id=String(form.get("template_id")||""),version=Number(form.get("version_number"));
 if(!Number.isInteger(version)||version<1)throw new Error("Numéro de version incorrect.");
 const {data:tpl,error}=await ctx.supabase.from("document_templates").select("id,document_type").eq("organization_id",ctx.organizationId).eq("id",id).single();
 if(error||!tpl)throw new Error("Modèle inaccessible.");
 await assertDocumentAction(ctx,"templates.edit_shared",tpl.document_type as "quote"|"invoice"|"payslip"|"report");
 const {data:record,error:readError}=await ctx.supabase.from("document_template_versions").select("configuration").eq("organization_id",ctx.organizationId).eq("template_id",id).eq("version_number",version).single();
 if(readError||!record)throw new Error("Version introuvable ou non autorisée.");
 const {error:writeError}=await ctx.supabase.from("document_templates").update({configuration:record.configuration}).eq("organization_id",ctx.organizationId).eq("id",id);
 if(writeError)throw new Error(writeError.message);
 revalidatePath("/modeles-documents/historique");revalidatePath("/modeles-documents");
}
const captions:Record<string,string>={draft:"Brouillon",in_review:"En révision",published:"Publié",archived:"Archivé"};
export default async function TemplateHistory(){
 const ctx=await requireOrganization();
 await assertPermission(ctx,"settings.manage");
 const {data,error}=await ctx.supabase.from("document_templates").select("id,name,document_type,lifecycle_status,version_number,is_default").eq("organization_id",ctx.organizationId).order("document_type");
 if(error)throw new Error(error.message);
 const ids=(data||[]).map(x=>x.id);
 const {data:versions,error:historyError}=ids.length?await ctx.supabase.from("document_template_versions").select("template_id,version_number,changed_at").eq("organization_id",ctx.organizationId).in("template_id",ids).order("version_number",{ascending:false}):{data:[],error:null};
 if(historyError)throw new Error(historyError.message);
 return <><div className="pageHead"><div><p className="eyebrow">Administration documentaire</p><h1>Historique et cycle de vie des modèles</h1><p>Chaque changement de configuration enregistre une nouvelle version. La restauration crée une nouvelle révision sans modifier les données métier.</p></div><Link href="/modeles-documents" className="button">Retour aux modèles</Link></div><div className="grid2">{(data||[]).map(t=><div className="card" key={t.id}><h2>{t.name} - {t.document_type}</h2><p>Statut : <strong>{captions[t.lifecycle_status]||t.lifecycle_status}</strong> | Version : {t.version_number}</p>{t.is_default&&<p className="muted">Modèle actuellement sélectionné par défaut.</p>}
 <div className="form">{(["submit_review","publish","archive","restore_draft"] as const).map(action=><form key={action} action={updateTemplate} className="form"><input type="hidden" name="template_id" value={t.id}/><input type="hidden" name="action" value={action}/><label><input type="checkbox" name="confirmed" value="yes" required/> Je confirme : {action}</label><button className="button" type="submit">{({submit_review:"Soumettre à révision",publish:"Publier",archive:"Archiver",restore_draft:"Remettre en brouillon"} as const)[action]}</button></form>)}</div>
 <h3>Versions enregistrées</h3>{(versions||[]).filter(v=>v.template_id===t.id).map(v=><form key={v.version_number} action={restoreTemplateVersion} className="form"><input type="hidden" name="template_id" value={t.id}/><input type="hidden" name="version_number" value={v.version_number}/><label><input type="checkbox" name="confirmed" value="yes" required/> Confirmer la restauration de la version {v.version_number}</label><button type="submit" className="button">Restaurer version {v.version_number}</button></form>)}
 </div>)}</div></>;
}
