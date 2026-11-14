"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { COMPANY_SECTORS, ACTIVITY_LABELS } from "@/lib/company/company-sectors";
import type { CompanyOnboarding } from "@/lib/company/onboarding-schema";
import { REGISTRATION_REGIONS } from "@/lib/auth/magnisa-identity";
import { supabaseBrowser } from "@/lib/supabase/client";
import { extractLogoPalette, LOGO_MIME_EXT, validLogoFile } from "@/lib/company/logo-palette";
import { createCompanyFromForm, saveCompanyOnboardingBranding, type CreateCompanyState } from "@/server/actions/company-onboarding";
import type { LocalitySuggestion } from "@/lib/geo/madagascar-localities";

const stages = ["Identité","Situation juridique","Localisation","Fiscalité et comptabilité","Confirmation"];
type Step = 0|1|2|3|4;
const DEFAULT: CompanyOnboarding = {
  legalName:"",tradeName:"",slogan:"",sectorCode:"",primaryActivity:"",secondaryActivities:[],
  legalForm:"EI",registrationStatus:"pending",nif:"",stat:"",rcs:"",
  country:"MG",regionCode:"",localityName:"",localityRef:"",address:"",phone:"",email:"",
  currency:"MGA",taxRegime:"A_VERIFIER",vatStatus:"A_VERIFIER",
  fiscalStart:"",fiscalEnd:"",hasExistingAccounts:false,
};
const labels:Record<string,string> = {
  EI:"Entreprise individuelle", SARL:"SARL",SARLU:"SARL unipersonnelle",
  SA:"Société anonyme", SAU:"SA unipersonnelle",SNC:"Société en nom collectif",
  SCS:"Société en commandite simple",COOPERATIVE:"Coopérative",ASSOCIATION:"Association",AUTRE:"Autre forme",
};
function FileField({id,title,file,onChange}:{id:string;title:string;file:File|null;onChange:(file:File|null)=>void}) {
  const [url,setUrl] = useState("");
  useEffect(()=>{
    if(!file){setUrl("");return;}
    const next=URL.createObjectURL(file);setUrl(next);
    return ()=>URL.revokeObjectURL(next);
  },[file]);
  return <div className="field">
    <label htmlFor={id}>{title} (facultatif)</label>
    {url && <img src={url} alt={`Aperçu ${title}`} style={{width:128,height:86,objectFit:"contain",borderRadius:8,padding:8,background:title.includes("inverse")?"#263348":"#f4f5f7"}} />}
    <input id={id} type="file" accept="image/png,image/jpeg,image/webp"
      onChange={event=>onChange(event.target.files?.[0]||null)} />
    {file && <small>{file.name} — {(file.size/1024/1024).toFixed(1)} Mo</small>}
  </div>;
}
function TextField({id,label,value,onChange,required=false,max=160,type="text",placeholder=""}:{
  id:string;label:string;value:string;onChange:(value:string)=>void;
  required?:boolean;max?:number;type?:string;placeholder?:string;
}) {
  return <div className="field"><label htmlFor={id}>{label}{required?" *":""}</label>
    <input id={id} type={type} required={required} maxLength={max}
      value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>
  </div>;
}
export function CompanyCreationWizard({year}:{year:number}) {
  const [step,setStep] = useState<Step>(0);
  const [hydrated,setHydrated] = useState(false);
  useEffect(()=>setHydrated(true),[]);
  const [details,setDetails] = useState<CompanyOnboarding>({
    ...DEFAULT, fiscalStart:`${year}-01-01`,fiscalEnd:`${year}-12-31`
  });
  const [group,setGroup] = useState("");
  const [activityQuery,setActivityQuery] = useState("");
  const [customActivity,setCustomActivity] = useState(false);
  const [secondaryDraft,setSecondaryDraft] = useState("");
  const [colorLogo,setColorLogo] = useState<File|null>(null);
  const [inverseLogo,setInverseLogo] = useState<File|null>(null);
  const [suggestions,setSuggestions] = useState<LocalitySuggestion[]>([]);
  const [searching,setSearching] = useState(false);
  const [uploadStatus,setUploadStatus] = useState<"idle"|"uploading"|"done"|"failed">("idle");
  const [uploadError,setUploadError] = useState("");
  const [state,submit,pending] = useActionState<CreateCompanyState,FormData>(
    createCompanyFromForm,{error:null,organizationId:null});
  const started=useRef<string|null>(null);
  const update=<K extends keyof CompanyOnboarding>(key:K,value:CompanyOnboarding[K])=>
    setDetails(old=>({...old,[key]:value}));
  const sector = COMPANY_SECTORS.find(s=>s.code===details.sectorCode);
  const groupActivities = sector?.groups.find(g=>g.label===group)?.activities||[];
  const listedActivities=groupActivities.filter(name=>name.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").includes(activityQuery.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")));
  const canAdvance = step===0 ? details.legalName.trim().length>=2 &&
    details.sectorCode.length>0 && details.primaryActivity.trim().length>=2
    : step===1 ? !!details.legalForm && !!details.registrationStatus
    : step===2 ? !!details.regionCode && details.localityName.trim().length>=2
    : step===3 ? !!details.taxRegime && !!details.vatStatus &&
      details.fiscalStart.length===10 && details.fiscalEnd>details.fiscalStart
    : true;

  useEffect(()=>{
    if(step!==2 || !details.regionCode || details.localityName.trim().length<2 || details.localityRef){
      setSuggestions([]);setSearching(false);return;
    }
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      setSearching(true);
      const qs=new URLSearchParams({region:details.regionCode,q:details.localityName});
      fetch(`/api/localities/suggest?${qs}`,{signal:controller.signal})
        .then(response=>response.ok?response.json():{results:[] as LocalitySuggestion[]})
        .then(response=>{if(!controller.signal.aborted)setSuggestions(response.results||[]);})
        .catch(()=>{if(!controller.signal.aborted)setSuggestions([]);})
        .finally(()=>{if(!controller.signal.aborted)setSearching(false);});
    },200);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[step,details.regionCode,details.localityName,details.localityRef]);

  const uploadBranding=async (organizationId:string) => {
    if(!colorLogo && !inverseLogo){setUploadStatus("done");return;}
    setUploadStatus("uploading");setUploadError("");
    try {
      const bucket=supabaseBrowser().storage.from("organization-branding");
      const upload=async(file:File|null,role:"color"|"inverse")=>{
        if(!file)return "";
        if(!await validLogoFile(file))throw new Error("Logo invalide : utilisez un fichier PNG, JPG ou WebP authentique.");
        const ext=LOGO_MIME_EXT[file.type];
        const path=`${organizationId}/${role}-${crypto.randomUUID()}.${ext}`;
        const {error}=await bucket.upload(path,file,{contentType:file.type,upsert:false,cacheControl:"3600"});
        if(error)throw new Error("Le stockage a refusé le logo " + role + " : " + error.message);
        return path;
      };
      const colorPath=await upload(colorLogo,"color");
      const inversePath=await upload(inverseLogo,"inverse");
      // A logo may contain only grayscale/transparent pixels or use a decoder
      // unavailable in some browsers. Retain a usable initial document theme.
      let palette = colorLogo ? {primaryColor:"#1663FF",secondaryColor:"#7B4DFF",accentColor:"#D93CFF"} : undefined;
      if(colorLogo){try{palette=await extractLogoPalette(colorLogo);}catch{/* retain defaults */}}
      const linked=await saveCompanyOnboardingBranding({
        organizationId,colorPath,inversePath,
        primaryColor:palette?.primaryColor,
        secondaryColor:palette?.secondaryColor,
        accentColor:palette?.accentColor,
      });
      if(linked.error)throw new Error(linked.error);
      setUploadStatus("done");
    }catch(error){
      setUploadError(error instanceof Error?error.message:"Importation des logos interrompue.");
      setUploadStatus("failed");
    }
  };
  useEffect(()=>{
    if(!state.organizationId || started.current===state.organizationId)return;
    started.current=state.organizationId;
    void uploadBranding(state.organizationId);
    // Run once per company creation: retries are always explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[state.organizationId]);

  const addSecondary=()=>{
    const name=secondaryDraft.trim();
    if(!name || details.secondaryActivities.some(x=>x.toLowerCase()===name.toLowerCase()) ||
      name.toLowerCase()===details.primaryActivity.toLowerCase())return;
    update("secondaryActivities",[...details.secondaryActivities,name]);
    setSecondaryDraft("");
  };

  if(state.organizationId){
    return <main className="auth authPremium"><div className="card section">
      <h1>Entreprise créée</h1>
      <p>L'espace <strong>{details.legalName}</strong> est enregistré. Ton compte est administrateur principal.</p>
      {uploadStatus==="uploading" && <p role="status">Importation des logos et préparation de la charte graphique…</p>}
      {uploadStatus==="done" && <p role="status">Les logos choisis ont été traités. La charte documentaire est modifiable dans les paramètres.</p>}
      {uploadStatus==="failed" && <div role="alert"><p className="error">{uploadError}</p>
        <p>Ton entreprise reste créée. Tu peux réessayer sans en créer une deuxième.</p>
        <button type="button" className="button" onClick={()=>void uploadBranding(state.organizationId!)}>Réessayer l'importation</button>
      </div>}
      <Link className="button primary" href="/parametres?onboarding=1">Accéder aux paramètres de l'entreprise</Link>
      <Link className="button" href="/dashboard">Ouvrir le tableau de bord</Link>
    </div></main>;
  }

  return <main className="auth authPremium" data-onboarding-hydrated={hydrated?"true":"false"} style={{maxWidth:900,margin:"0 auto"}}>
    <p className="eyebrow">Configuration d'un espace professionnel</p>
    <h1>Créer une entreprise</h1>
    <p className="muted">Ton compte personnel reste indépendant. La création d'un espace MAGNISA ne remplace pas une immatriculation légale.</p>
    <div aria-label="Étapes de création" style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:6,margin:"20px 0"}}>
      {stages.map((label,index)=><div key={label} style={{minWidth:0}}>
        <div style={{height:5,borderRadius:9,background:index<=step?"#1663FF":"#ced4de"}}/>
        <small style={{display:"block",marginTop:6,fontWeight:index===step?700:400,overflowWrap:"break-word"}}>{index+1}. {label}</small>
      </div>)}
    </div>
    <section className="card section">
      <h2>{stages[step]}</h2>
      {step===0 && <>
        <div className="grid2">
          <TextField id="co-legal-name" label="Raison sociale / nom de l'entreprise" required value={details.legalName} onChange={v=>update("legalName",v)}/>
          <TextField id="co-trade-name" label="Nom commercial" value={details.tradeName} onChange={v=>update("tradeName",v)}/>
        </div>
        <TextField id="co-slogan" label="Slogan" value={details.slogan} onChange={v=>update("slogan",v)}/>
        <div className="grid2">
          <FileField id="company-color-logo" title="Logo couleur" file={colorLogo} onChange={setColorLogo}/>
          <FileField id="company-inverse-logo" title="Logo inverse" file={inverseLogo} onChange={setInverseLogo}/>
        </div>
        <p className="muted">Les originaux seront conservés en privé. La détection des couleurs préparera une charte documentaire modifiable plus tard. PNG, JPEG et WebP sont acceptés ; la capacité dépend de la limite technique de stockage du forfait.</p>
        <div className="field"><label htmlFor="co-sector">Secteur d'activité *</label>
          <select id="co-sector" required value={details.sectorCode} onChange={e=>{
            update("sectorCode",e.target.value);update("primaryActivity","");setGroup("");setActivityQuery("");setCustomActivity(false);
          }}>
            <option value="">Choisir un secteur</option>
            {COMPANY_SECTORS.map(s=><option value={s.code} key={s.code}>{s.code} — {s.label}</option>)}
          </select>
        </div>
        {sector && <><div className="field"><label htmlFor="co-group">Sous-secteur</label>
          <select id="co-group" value={group} onChange={e=>{setGroup(e.target.value);update("primaryActivity","");setCustomActivity(false);}}>
            <option value="">Choisir un sous-secteur</option>
            {sector.groups.map(g=><option key={g.label} value={g.label}>{g.label}</option>)}
          </select>
        </div>
        {group && <div className="field"><label htmlFor="co-activity-search">Rechercher une activité</label>
          <input id="co-activity-search" value={activityQuery} onChange={e=>setActivityQuery(e.target.value)} placeholder="Ex. : épicerie, coiffure, transport…"/>
          <label htmlFor="co-activity">Activité principale *</label>
          <select id="co-activity" value={customActivity?"custom":details.primaryActivity} onChange={e=>{
            if(e.target.value==="custom"){setCustomActivity(true);update("primaryActivity","");}
            else{setCustomActivity(false);update("primaryActivity",e.target.value);}
          }}>
            <option value="">Choisir une activité</option>
            {listedActivities.map(a=><option value={a} key={a}>{a}</option>)}
            <option value="custom">Autre activité — préciser</option>
          </select>
        </div>}
        </>}
        {customActivity && <TextField id="co-other-activity" label="Préciser l'activité principale" required value={details.primaryActivity} onChange={v=>update("primaryActivity",v)}/>}
        <div className="field"><label htmlFor="co-secondary">Activités secondaires (facultatif)</label>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <input id="co-secondary" style={{flex:"1 1 230px"}} list="co-secondary-options" value={secondaryDraft}
              onChange={e=>setSecondaryDraft(e.target.value)} placeholder="Rechercher ou saisir une activité" maxLength={160}/>
            <datalist id="co-secondary-options">{ACTIVITY_LABELS.map((x,i)=><option value={x.activity} key={x.sector+i}/>)}</datalist>
            <button type="button" className="button" onClick={addSecondary}>Ajouter</button>
          </div>
          {details.secondaryActivities.map(activity=><span key={activity} style={{display:"inline-flex",gap:6,margin:"6px 8px 0 0",alignItems:"center"}}>
            {activity}<button type="button" aria-label={`Retirer ${activity}`}
              onClick={()=>update("secondaryActivities",details.secondaryActivities.filter(x=>x!==activity))}>×</button>
          </span>)}
          <small>Catalogue initial de suggestions. Le code NOMAC officiel sera vérifié séparément.</small>
        </div>
      </>}
      {step===1 && <>
        <div className="field"><label htmlFor="co-form">Forme juridique *</label><select id="co-form"
          value={details.legalForm} onChange={e=>update("legalForm",e.target.value as CompanyOnboarding["legalForm"])}>
          {Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></div>
        <div className="field"><label htmlFor="co-status">Situation administrative *</label><select id="co-status"
          value={details.registrationStatus} onChange={e=>update("registrationStatus",e.target.value as CompanyOnboarding["registrationStatus"])}>
          <option value="registered">Déjà immatriculée</option>
          <option value="pending">En cours de formalisation / non immatriculée</option>
        </select></div>
        {details.registrationStatus==="registered" && <div className="grid2">
          <TextField id="co-nif" label="NIF (si disponible)" value={details.nif} onChange={v=>update("nif",v)}/>
          <TextField id="co-stat" label="STAT (si disponible)" value={details.stat} onChange={v=>update("stat",v)}/>
          <TextField id="co-rcs" label="RCS (si applicable)" value={details.rcs} onChange={v=>update("rcs",v)}/>
        </div>}
        <p className="muted">Ces informations sont déclaratives. MAGNISA n'attribue pas de numéro officiel et ne vérifie pas automatiquement l'immatriculation.</p>
      </>}
      {step===2 && <>
        <div className="grid2">
          <div className="field"><label>Pays *</label><input value="Madagascar" readOnly/></div>
          <div className="field"><label htmlFor="co-region">Région *</label>
            <select id="co-region" required value={details.regionCode} onChange={e=>{
              update("regionCode",e.target.value);update("localityName","");update("localityRef","");setSuggestions([]);
            }}>
              <option value="">Choisir la région</option>
              {REGISTRATION_REGIONS.map(r=><option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label htmlFor="co-locality">Ville, commune, fokontany ou village *</label>
          <input id="co-locality" required minLength={2} maxLength={160} disabled={!details.regionCode}
            value={details.localityName} onChange={e=>{update("localityName",e.target.value);update("localityRef","");}}
            placeholder="Commencer à saisir le nom de la localité"/>
          {searching && <small role="status">Recherche de suggestions…</small>}
          {suggestions.length>0 && <div style={{maxHeight:210,overflow:"auto",border:"1px solid #dde1e6",borderRadius:8}}>
            {suggestions.map(s=><button key={s.ref} type="button" onClick={()=>{
              update("localityName",s.name);update("localityRef",s.ref);setSuggestions([]);
            }} style={{display:"block",width:"100%",textAlign:"left",padding:10,border:0,background:"transparent"}}>
              {s.name} <small>— {s.commune}, district de {s.district}</small>
            </button>)}
          </div>}
          <small>Si le village n'apparaît pas, conserve le nom saisi. L'adresse de l'entreprise est indépendante de ta résidence personnelle.</small>
        </div>
        <TextField id="co-address" label="Adresse du siège ou de l'activité" value={details.address} max={300}
          onChange={v=>update("address",v)} placeholder="Quartier, rue, repère…"/>
        <div className="grid2">
          <TextField id="co-phone" label="Téléphone professionnel" value={details.phone} onChange={v=>update("phone",v)}/>
          <TextField id="co-email" label="E-mail professionnel" value={details.email} type="email" max={254} onChange={v=>update("email",v)}/>
        </div>
      </>}
      {step===3 && <>
        <div className="grid2">
          <div className="field"><label htmlFor="co-tax">Régime fiscal déclaré *</label><select id="co-tax"
            value={details.taxRegime} onChange={e=>update("taxRegime",e.target.value as CompanyOnboarding["taxRegime"])}>
            <option value="A_VERIFIER">À confirmer</option><option value="IS">IS — Impôt synthétique</option>
            <option value="IR">IR — Impôt sur les revenus</option>
          </select></div>
          <div className="field"><label htmlFor="co-vat">Situation TVA *</label><select id="co-vat" value={details.vatStatus}
            onChange={e=>update("vatStatus",e.target.value as CompanyOnboarding["vatStatus"])}>
            <option value="A_VERIFIER">À confirmer</option>
            <option value="ASSUJETTIE">Assujettie à la TVA</option>
            <option value="NON_ASSUJETTIE">Non assujettie à la TVA</option>
          </select></div>
        </div>
        <div className="grid2">
          <TextField id="co-start" label="Début de l'exercice comptable" required type="date" value={details.fiscalStart} onChange={v=>update("fiscalStart",v)}/>
          <TextField id="co-end" label="Fin de l'exercice comptable" required type="date" value={details.fiscalEnd} onChange={v=>update("fiscalEnd",v)}/>
        </div>
        <div className="field"><label htmlFor="co-currency">Devise de gestion *</label>
          <select id="co-currency" value={details.currency} onChange={e=>update("currency",e.target.value as CompanyOnboarding["currency"])}>
            <option value="MGA">Ariary malgache (MGA)</option><option value="EUR">Euro (EUR)</option><option value="USD">Dollar US (USD)</option>
          </select>
        </div>
        <label style={{display:"flex",gap:8,alignItems:"flex-start"}}>
          <input style={{width:"auto",marginTop:5}} type="checkbox" checked={details.hasExistingAccounts}
            onChange={e=>update("hasExistingAccounts",e.target.checked)}/>
          J'ai des comptes bancaires ou une comptabilité existante à reprendre ultérieurement.
        </label>
        <p className="muted">Les dates sont enregistrées comme projet d'exercice. L'ouverture comptable, la reprise des soldes et l'activation des déclarations fiscales se feront après vérification dans les paramètres.</p>
      </>}
      {step===4 && <>
        <h3>Vérifier les données avant de créer l'espace</h3>
        <div className="grid2">
          <p><strong>Entreprise :</strong> {details.legalName}<br/>
            <strong>Nom commercial :</strong> {details.tradeName||"Non renseigné"}<br/>
            <strong>Secteur :</strong> {sector?.label}<br/>
            <strong>Activité :</strong> {details.primaryActivity}</p>
          <p><strong>Forme :</strong> {labels[details.legalForm]}<br/>
            <strong>Statut :</strong> {details.registrationStatus==="registered"?"Immatriculée":"En cours de formalisation"}<br/>
            <strong>Région :</strong> {REGISTRATION_REGIONS.find(x=>x.code===details.regionCode)?.name}<br/>
            <strong>Localité :</strong> {details.localityName}</p>
          <p><strong>Régime :</strong> {details.taxRegime}<br/>
            <strong>TVA :</strong> {details.vatStatus}<br/>
            <strong>Exercice :</strong> {details.fiscalStart} au {details.fiscalEnd}<br/>
            <strong>Devise :</strong> {details.currency}</p>
          <p><strong>Logo couleur :</strong> {colorLogo?.name||"À ajouter plus tard"}<br/>
            <strong>Logo inverse :</strong> {inverseLogo?.name||"À ajouter plus tard"}<br/>
            <strong>Activités secondaires :</strong> {details.secondaryActivities.length}</p>
        </div>
        <p className="muted">La création sera réalisée une seule fois. Tu deviendras administrateur principal et pourras compléter les justificatifs, la charte documentaire et les comptes existants ensuite.</p>
        <form action={submit} className="form">
          <input type="hidden" name="payload" value={JSON.stringify(details)}/>
          {state.error && <p className="error" role="alert">{state.error}</p>}
          <button type="submit" className="button primary" disabled={pending}>
            {pending?"Création de l'espace…":"Créer mon entreprise"}
          </button>
        </form>
      </>}
      <div style={{display:"flex",justifyContent:"space-between",gap:12,marginTop:24}}>
        {step>0 && <button type="button" className="button" disabled={pending}
          onClick={()=>setStep((step-1) as Step)}>Précédent</button>}
        {step<4 && <button type="button" className="button primary" disabled={!canAdvance}
          onClick={()=>setStep((step+1) as Step)}>Suivant</button>}
      </div>
    </section>
    <p className="muted"><Link href="/choisir-organisation">Retour aux entreprises</Link></p>
  </main>;
}
