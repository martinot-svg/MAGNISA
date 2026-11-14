"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { extractLogoPalette, LOGO_MIME_EXT, validLogoFile } from "@/lib/company/logo-palette";
import { saveCompanyOnboardingBranding } from "@/server/actions/company-onboarding";

/** Direct private Storage uploads avoid Next.js Server Action body-size limits.
 * Original images are retained. Effective maximum is the plan's Storage cap. */
export function CompanyBrandingUploader({organizationId,disabled}:{organizationId:string;disabled:boolean}) {
  const [color,setColor] = useState<File|null>(null);
  const [inverse,setInverse] = useState<File|null>(null);
  const [pending,setPending] = useState(false);
  const [message,setMessage] = useState("");
  const [failed,setFailed] = useState(false);
  async function save(){
    if(!color && !inverse)return;
    setMessage("");setFailed(false);setPending(true);
    try{
      const bucket=supabaseBrowser().storage.from("organization-branding");
      const upload=async (file:File|null,role:"color"|"inverse")=>{
        if(!file)return "";
        if(!await validLogoFile(file))throw new Error("Le fichier "+role+" n'est pas un PNG, JPG ou WebP valide.");
        const path=`${organizationId}/${role}-${crypto.randomUUID()}.${LOGO_MIME_EXT[file.type]}`;
        const {error}=await bucket.upload(path,file,{upsert:false,contentType:file.type});
        if(error)throw new Error("Impossible d'importer le logo : "+error.message);
        return path;
      };
      const colorPath=await upload(color,"color");
      const inversePath=await upload(inverse,"inverse");
      let palette=color ? {primaryColor:"#1663FF",secondaryColor:"#7B4DFF",accentColor:"#D93CFF"} : undefined;
      if(color)try{palette=await extractLogoPalette(color);}catch{/* retain defaults */}
      const r=await saveCompanyOnboardingBranding({
        organizationId,colorPath,inversePath,primaryColor:palette?.primaryColor,
        secondaryColor:palette?.secondaryColor,accentColor:palette?.accentColor,
      });
      if(r.error)throw new Error(r.error);
      setMessage("Logos enregistrés. Les couleurs proposées sont modifiables dans la charte documentaire.");
      setColor(null);setInverse(null);
    }catch(error){setFailed(true);setMessage(error instanceof Error?error.message:"Importation interrompue.");}
    finally{setPending(false);}
  }
  if(disabled)return null;
  return <div className="card section">
    <h3>Importer les logos couleur et inverse</h3>
    <p className="muted">Importation directe et sécurisée, sans petite limite arbitraire. Le forfait gratuit permet jusqu'à 50 Mo par fichier, selon la configuration du stockage.</p>
    <div className="grid2">
      <div className="field"><label htmlFor="branding-color-file">Logo couleur</label>
        <input id="branding-color-file" type="file" accept="image/png,image/jpeg,image/webp"
          onChange={event=>setColor(event.target.files?.[0]||null)}/></div>
      <div className="field"><label htmlFor="branding-inverse-file">Logo inverse</label>
        <input id="branding-inverse-file" type="file" accept="image/png,image/jpeg,image/webp"
          onChange={event=>setInverse(event.target.files?.[0]||null)}/></div>
    </div>
    <button type="button" className="button primary" disabled={pending||(!color&&!inverse)} onClick={()=>void save()}>
      {pending?"Importation des logos…":"Enregistrer les logos"}
    </button>
    {message&&<p role="status" className={failed?"error":"muted"}>{message}</p>}
  </div>;
}
