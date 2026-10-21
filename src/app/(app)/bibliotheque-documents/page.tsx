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
 return <><div className="pageHead"><div><p className="eyebrow">Documents</p><h1>Bibliothèque des modèles</h1><p>Choisis un modèle pour les devis, factures, bulletins de paie et rapports. Le modèle de facture inspiré de ton design Canva est identifié séparément.</p></div><Link className="button" href="/modeles-documents">Personnaliser le modèle actif</Link></div>
 <div className="card section"><form method="get" className="grid2">
 <div className="field"><label>Rechercher</label><input type="search" name="q" defaultValue={p.q||""} placeholder="Nom, catégorie ou description"/></div>
 <div className="field"><label>Catégorie de document</label><select name="type" defaultValue={type}><option value="">Toutes</option><option value="quote">Devis</option><option value="invoice">Factures</option><option value="payslip">Bulletins de paie</option><option value="report">Rapports de gestion</option></select></div>
 <div className="field"><label>Style</label><select name="style" defaultValue={style}><option value="">Tous les styles</option>{[...new Set(DOCUMENT_PRESETS.map(x=>x.style))].map(v=><option key={v} value={v}>{v}</option>)}</select></div>
 <div className="field"><label>Filtrer</label><button type="submit" className="button">Rechercher les modèles</button></div>
 </form></div>
 <p className="muted">{list.length} configuration(s) visuelle(s) proposée(s). Une sélection applique un style au modèle par défaut du type concerné, sans modifier les données de facturation ou de paie.</p>
 <div className="grid2">{list.map(preset=><div className="card" key={preset.id}>
 <div style={{background:"#fff",border:"1px solid #dfe5eb",padding:18,color:"#172033",borderRadius:8,minHeight:245}}>
 <div style={{height:5,background:preset.configuration.primaryColor,marginBottom:14}}/>
 <div style={{display:"flex",justifyContent:"space-between",gap:12,borderBottom:"2px solid #d0d2d4",paddingBottom:12}}><div><strong style={{fontFamily:preset.configuration.fontFamily,color:preset.configuration.primaryColor,fontSize:13}}>VOTRE ENTREPRISE</strong><div style={{fontSize:9,color:"#667085",marginTop:4}}>Adresse et coordonnées</div></div><div style={{textAlign:"right"}}><strong style={{fontSize:15,color:preset.configuration.primaryColor}}>{preset.type==="invoice"?"FACTURE":preset.type==="quote"?"DEVIS":preset.type==="payslip"?"BULLETIN DE PAIE":"RAPPORT"}</strong><div style={{fontSize:9,color:"#667085",marginTop:4}}>N° - Date</div></div></div>
 <div style={{fontSize:10,marginTop:14,marginBottom:12}}><strong>Client / Destinataire</strong><div style={{height:4,width:"45%",background:"#e5e7eb",marginTop:5}}/></div>
 <div style={{background:"#e8e9ea",display:"grid",gridTemplateColumns:"2fr .5fr 1fr",padding:"7px 6px",fontSize:9,fontWeight:700}}><span>Description</span><span>Qté</span><span style={{textAlign:"right"}}>Montant</span></div>
 {[0,1,2].map(i=><div key={i} style={{display:"grid",gridTemplateColumns:"2fr .5fr 1fr",padding:"8px 6px",fontSize:9,borderBottom:"1px solid #d0d2d4",background:i%2?"#f7f7f7":"#fff"}}><span>Prestation / détail</span><span>1</span><span style={{textAlign:"right"}}>0 Ar</span></div>)}
 <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}><div style={{width:120,fontSize:9,textAlign:"right"}}><div>Sous-total : 0 Ar</div><strong style={{display:"block",borderTop:"1px solid #d0d2d4",marginTop:5,paddingTop:5,color:preset.configuration.primaryColor}}>Total : 0 Ar</strong></div></div>
 </div>
 <h3>{preset.name}</h3><p className="muted">{preset.category} - {preset.style}</p><p>{preset.description}</p>{preset.provenance==="user-provided design reference"?<><p className="muted">Référence fournie par ton entreprise - modèle de facture inspiré du design Canva.</p><p><a href="https://www.canva.com/design/DAHYot6hBfI/rBh1DlTVJYmMFEOQ5lRTkA/edit" target="_blank" rel="noreferrer">Ouvrir le design Canva d’origine</a></p></>:<p className="muted">Création originale MAGNISA - licence propriétaire interne.</p>}
 {active.get(preset.type)===preset.id?<p><strong>Modèle par défaut sélectionné</strong></p>:canEdit?<form action={selectPreset}><input type="hidden" name="preset_id" value={preset.id}/><button className="button primary" type="submit">Utiliser pour {preset.type==="quote"?"les devis":preset.type==="invoice"?"les factures":preset.type==="payslip"?"la paie":"les rapports"}</button></form>:<p className="muted">Sélection réservée à l'administrateur.</p>}
 </div>)}</div>
 </>;
}
