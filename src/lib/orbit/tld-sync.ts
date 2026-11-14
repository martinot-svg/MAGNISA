import {createAdminClient} from "@/lib/supabase/admin";
import {fetchOfficialTldCatalog} from "./tld-catalog";
/** Restricted backend sync. Never assigns domain ownership or registration availability. */
export async function synchronizeMagniboxTlds(){
 const entries=await fetchOfficialTldCatalog();
 const db=createAdminClient();
 const stamp=new Date().toISOString();
 for(let i=0;i<entries.length;i+=150){
   const batch=entries.slice(i,i+150).map(e=>({
     suffix:e.suffix,suffix_type:e.type,category:e.category,country_code:e.country,
     description:e.type==="tld"?"Domaine de premier niveau IANA":"Zone descriptive du registre national",
     eligibility:e.eligibility,registry:e.registry,source_url:e.source,
     registration_status:"non_verifiee",verification_status:e.status,
     is_active:true,synced_at:stamp,
   }));
   const {error}=await db.from("magnibox_tld_catalog").upsert(batch,{onConflict:"suffix",ignoreDuplicates:true});
   if(error)throw new Error("Synchronisation des TLD impossible : "+error.code);
 }
 return {count:entries.length,syncedAt:stamp};
}
