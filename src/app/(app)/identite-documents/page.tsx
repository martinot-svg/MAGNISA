import Link from "next/link";
import {revalidatePath} from "next/cache";
import {requireOrganization} from "@/lib/current-org";
import {requirePermission,assertPermission} from "@/lib/permissions";
import {readDocumentThemeForm} from "@/lib/document-theme";
import {BrandingThemeEditor} from "@/components/branding-theme-editor";

async function saveDocumentTheme(fd:FormData){
 "use server";
 const ctx=await requireOrganization();
 await assertPermission(ctx,"settings.manage");
 if(!["owner","admin"].includes(ctx.role))throw new Error("Seul un administrateur peut modifier la charte de l'entreprise.");
 const document_theme=readDocumentThemeForm(fd);
 const {error}=await ctx.supabase.from("company_settings").upsert({organization_id:ctx.organizationId,document_theme},{onConflict:"organization_id"});
 if(error)throw new Error(error.message);
 revalidatePath("/identite-documents");revalidatePath("/modeles-documents");
}
export default async function DocumentIdentityPage(){
 const ctx=await requireOrganization();await requirePermission(ctx,"settings.manage");
 const [{data:settings,error},{data:org}]=await Promise.all([
 ctx.supabase.from("company_settings").select("trade_name,legal_name,document_theme").eq("organization_id",ctx.organizationId).maybeSingle(),
 ctx.supabase.from("organizations").select("name").eq("id",ctx.organizationId).single()
 ]);
 if(error)throw new Error(error.message);
 return <><div className="pageHead"><div><p className="eyebrow">Paramètres</p><h1>Identité visuelle et documents</h1><p>La charte générale définit la base des nouveaux modèles. Les devis et factures conservent leurs réglages spécifiques.</p></div><Link href="/parametres" className="button">Paramètres de l'entreprise</Link></div>
 <div className="card section"><h2>Identité et éléments de marque</h2><p>Nom commercial, raison sociale, adresse, logo, NIF, STAT, RCS, signature et informations de contact sont gérés dans les paramètres existants de l'entreprise.</p><Link className="button" href="/parametres">Modifier l'identité et le logo</Link></div>
 <form action={saveDocumentTheme} id="brand-theme-form"><BrandingThemeEditor initial={settings?.document_theme} company={settings?.trade_name||settings?.legal_name||org?.name||""}/><div className="card" style={{marginTop:12}}><button className="button primary" type="submit">Enregistrer la charte documentaire</button></div></form>
 <div className="card section"><h2>Modèles individuels</h2><p>Le devis et la facture possèdent leurs propres modèles enregistrés. Un réglage propre au modèle remplace la valeur de la charte globale pour ce document seulement.</p><Link className="button" href="/bibliotheque-documents">Explorer la bibliothèque</Link> <Link className="button" href="/modeles-documents">Personnaliser les modèles</Link><p className="muted">Les bulletins de paie et les rapports restent soumis à leurs propres contraintes de lisibilité et de confidentialité.</p></div>
 </>;
}
