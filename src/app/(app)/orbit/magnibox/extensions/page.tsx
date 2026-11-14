import Link from "next/link";
import {requireOrganization} from "@/lib/current-org";
import {hasPermission} from "@/lib/permissions";
import {MagniboxTldCatalog} from "@/components/magnibox-tld-catalog";
import {fetchOfficialTldCatalog,type TldEntry} from "@/lib/orbit/tld-catalog";
export const runtime="nodejs";

export default async function MagniboxExtensions(){
 const ctx=await requireOrganization();
 if(!await hasPermission(ctx,"users.manage")) return <div className="card section" role="alert">
   Accès réservé aux administrateurs autorisés de l'entreprise.
 </div>;
 let entries:TldEntry[]=[];
 let unavailable=false;
 try{entries=await fetchOfficialTldCatalog()}catch{unavailable=true;}
 // Persisted metadata may enrich the current authoritative live list, never invent a TLD.
 let syncedAt:string|null=null;
 const {data:metadata,error}=await ctx.supabase.from("magnibox_tld_catalog")
   .select("suffix,is_active,eligibility,verification_status,synced_at")
   .order("synced_at",{ascending:false}).limit(2000);
 if(!error&&metadata?.length){
   syncedAt=metadata[0].synced_at;
   const catalogBySuffix=new Map(metadata.map(row=>[row.suffix,row]));
   entries=entries.map(e=>{
     const m=catalogBySuffix.get(e.suffix);
     return m?{...e,eligibility:e.country==="MG"?e.eligibility:m.eligibility,
       status:!m.is_active?"desactive":e.status}:e;
   });
 }
 return <><div className="pageHead"><div>
   <p className="eyebrow">Magnisa Orbit · Magnibox</p>
   <h1>Extensions de domaines professionnels</h1>
   <p>Rechercher les TLD internationaux et les suffixes nationaux, avec les règles NIC.MG.</p>
 </div><Link className="button" href="/orbit/magnibox">Retour à Magnibox</Link></div>
 {unavailable?<div role="alert" className="card section">
   Impossible de valider actuellement la liste IANA : aucune extension ne sera présentée comme vérifiée.
   Réessayez lorsque la source officielle sera disponible.
 </div>:<MagniboxTldCatalog entries={entries} syncedAt={syncedAt}/>}
 </>;
}
