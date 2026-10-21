import {canDocumentAction} from "@/lib/document-permissions";
import Link from "next/link";
import {revalidatePath} from "next/cache";
import {requireOrganization} from "@/lib/current-org";
import {assertPermission,requirePermission} from "@/lib/permissions";
import {DOCUMENT_PRESETS,getDocumentPreset} from "@/lib/document-presets";

async function selectPreset(form:FormData){
 "use server";
 const ctx=await requireOrganization();
 if(!(await canDocumentAction(ctx,"templates.set_default",getDocumentPreset(String(form.get("preset_id")||""))?.type||"report")))throw new Error("Action documentaire interdite.");
 if(!["owner","admin"].includes(ctx.role))throw new Error("Action réservée aux administrateurs de l'entreprise.");
 const id=String(form.get("preset_id")||"");
 const preset=getDocumentPreset(id);if(!preset)throw new Error("Modèle inconnu.");
 const {error}=await ctx.supabase.from("document_templates").upsert({
   organization_id:ctx.organizationId,document_type:preset.type,name:"Défaut",is_default:true,
   configuration:{...preset.configuration,selectedPresetId:preset.id}
 },{onConflict:"organization_id,document_type,name"});
 if(error)throw new Error(error.message);
 revalidatePath("/bibliotheque-documents");revalidatePath("/modeles-documents");
}
export default async function DocumentLibrary({searchParams}:{searchParams:Promise<{type?:string;style?:string;q?:string}>}){
 const ctx=await requireOrganization();await requirePermission(ctx,"settings.manage");
 const p=await searchParams;const types=["quote","invoice","payslip","report"];
 const type=types.includes(p.type||"")?p.type:"";
 const style=String(p.style||"").slice(0,35),q=String(p.q||"").trim().toLocaleLowerCase("fr").slice(0,80);
 const list=DOCUMENT_PRESETS.filter(x=>(!type||x.type===type)&&(!style||x.style===style)&&(!q||(x.name+" "+x.category+" "+x.description).toLocaleLowerCase("fr").includes(q)));
 const {data:existing,error}=await ctx.supabase.from("document_templates").select("document_type,configuration").eq("organization_id",ctx.organizationId).eq("is_default",true);
 if(error)throw new Error("Chargement des modèles impossible.");
 const active=new Map((existing||[]).map(x=>[x.document_type,(x.configuration as {selectedPresetId?:string}|null)?.selectedPresetId]));
 const canEdit=["owner","admin"].includes(ctx.role);
 return <><div className="pageHead"><div><p className="eyebrow">Documents</p><h1>Bibliothèque des modèles</h1><p>Modèles graphiques originaux MAGNISA pour les quatre types de PDF actuellement générés. Aucun document métier fictif n'est créé.</p></div><Link className="button" href="/modeles-documents">Personnaliser le modèle actif</Link></div>
 <div className="card section"><form method="get" className="grid2">
 <div className="field"><label>Rechercher</label><input type="search" name="q" defaultValue={p.q||""} placeholder="Nom, catégorie ou description"/></div>
 <div className="field"><label>Catégorie de document</label><select name="type" defaultValue={type}><option value="">Toutes</option><option value="quote">Devis</option><option value="invoice">Factures</option><option value="payslip">Bulletins de paie</option><option value="report">Rapports de gestion</option></select></div>
 <div className="field"><label>Style</label><select name="style" defaultValue={style}><option value="">Tous les styles</option>{[...new Set(DOCUMENT_PRESETS.map(x=>x.style))].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
 <div className="field"><label>Filtrer</label><button type="submit" className="button">Rechercher les modèles</button></div>
 </form></div>
 <p className="muted">{list.length} configuration(s) visuelle(s) proposée(s). Une sélection applique un style au modèle par défaut du type concerné, sans modifier les données de facturation ou de paie.</p>
 <div className="grid2">{list.map(preset=><div className="card" key={preset.id}>
 <div style={{background:"#fff",border:"1px solid #dfe5eb",padding:18,color:"#172033",borderRadius:8}}>
 <div style={{height:5,background:preset.configuration.primaryColor,marginBottom:12}}/>
 <strong style={{fontFamily:preset.configuration.fontFamily,color:preset.configuration.primaryColor}}>{preset.name}</strong>
 <div style={{borderTop:"1px solid #dfe5eb",marginTop:12,paddingTop:10,fontSize:12}}>En-tête du document</div>
 <div style={{height:5,background:preset.configuration.secondaryColor,opacity:.5,marginTop:12,width:"75%"}}/>
 </div>
 <h3>{preset.name}</h3><p className="muted">{preset.category} - {preset.style}</p><p>{preset.description}</p>{preset.provenance==="user-provided design reference"?<><p className="muted">Référence fournie par ton entreprise - modèle de facture inspiré du design Canva.</p><p><a href="https://www.canva.com/design/DAHYot6hBfI/rBh1DlTVJYmMFEOQ5lRTkA/edit" target="_blank" rel="noreferrer">Ouvrir le design Canva d’origine</a></p></>:<p className="muted">Création originale MAGNISA - licence propriétaire interne.</p>}
 {active.get(preset.type)===preset.id?<p><strong>Modèle par défaut sélectionné</strong></p>:canEdit?<form action={selectPreset}><input type="hidden" name="preset_id" value={preset.id}/><button className="button primary" type="submit">Utiliser pour {preset.type==="quote"?"les devis":preset.type==="invoice"?"les factures":preset.type==="payslip"?"la paie":"les rapports"}</button></form>:<p className="muted">Sélection réservée à l'administrateur.</p>}
 </div>)}</div>
 </>;
}
