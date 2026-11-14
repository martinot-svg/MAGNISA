"use client";
import {useMemo,useState} from "react";
import type {TldEntry,TldCategory} from "@/lib/orbit/tld-catalog";
import Link from "next/link";

type Props={entries:TldEntry[],syncedAt:string|null};
const categories: {value:string;label:string}[]=[
 {value:"",label:"Toutes les catégories"},{value:"madagascar",label:"Madagascar"},
 {value:"international",label:"Internationales"},{value:"professionnel",label:"Professionnelles"},
 {value:"technologie",label:"Technologiques"},{value:"creation",label:"Marketing et création"},
 {value:"finance",label:"Financières"},{value:"commerce",label:"Commerciales"},
 {value:"sectoriel",label:"Sectorielles"},{value:"national",label:"Nationales"},
 {value:"autre",label:"Autres"}];
function statusLabel(entry:TldEntry) {
 if(entry.status==="desactive")return "Désactivée";
 if(entry.status==="restreint")return "Conditions particulières";
 return "Inscription non vérifiée";
}
export function MagniboxTldCatalog({entries,syncedAt}:Props){
 const [search,setSearch]=useState("");
 const [category,setCategory]=useState("");
 const [country,setCountry]=useState("");
 const [selected,setSelected]=useState("");
 const filtered=useMemo(()=>entries.filter(e=>
   (!category||e.category===category as TldCategory)&&
   (!country||(country==="other"?e.country===null:e.country===country))&&
   (!search||e.suffix.includes(search.trim().toLowerCase().replace(/^\./,""))||e.eligibility.toLowerCase().includes(search.toLowerCase()))
 ).sort((a,b)=>Number(b.country==="MG")-Number(a.country==="MG")||a.suffix.localeCompare(b.suffix)),[entries,search,category,country]);
 const selectedEntry=entries.find(e=>e.suffix===selected);
 return <div className="card section">
   <h2>Catalogue des extensions ({entries.length})</h2>
   <p className="muted">Source des TLD : IANA. Les zones .mg descriptives suivent la charte NIC.MG.
     Les statuts ne garantissent jamais qu'un domaine est libre à l'enregistrement.</p>
   {syncedAt&&<p className="muted">Dernière synchronisation enregistrée : {new Date(syncedAt).toLocaleDateString("fr-FR")}</p>}
   <div className="form" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
     <div className="field"><label htmlFor="tld-search">Rechercher une extension</label>
       <input id="tld-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder=".mg, .tech, .com.mg…" /></div>
     <div className="field"><label htmlFor="tld-category">Catégorie</label>
       <select id="tld-category" value={category} onChange={e=>setCategory(e.target.value)}>
       {categories.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
     <div className="field"><label htmlFor="tld-country">Territoire</label>
       <select id="tld-country" value={country} onChange={e=>setCountry(e.target.value)}>
       <option value="">Tous</option><option value="MG">Madagascar</option>
       <option value="other">Autres / internationaux</option></select></div>
   </div>
   <p className="muted">{filtered.length} résultat(s). Les 80 premiers résultats sont affichés ; affinez la recherche pour trouver les suivants.</p>
   <div className="tableWrap"><table><thead><tr>
     <th>Extension</th><th>Nature</th><th>Catégorie</th><th>Enregistrement</th><th>Détails</th>
   </tr></thead><tbody>{filtered.slice(0,80).map(e=><tr key={e.suffix}>
     <td><strong>{e.suffix}</strong></td>
     <td>{e.type==="tld"?"TLD IANA":"Zone nationale composée"}</td>
     <td>{categories.find(c=>c.value===e.category)?.label||"Autres"}</td>
     <td>{statusLabel(e)}</td>
     <td><button type="button" className="button" onClick={()=>setSelected(e.suffix)}>Examiner</button></td>
   </tr>)}</tbody></table></div>
   {selectedEntry&&<div className="card section" aria-live="polite">
     <h3>{selectedEntry.suffix}</h3>
     <p><strong>Conditions :</strong> {selectedEntry.eligibility}</p>
     <p><strong>Registre :</strong> {selectedEntry.registry||"À confirmer auprès du registre compétent"}.</p>
     <p><strong>Disponibilité d'un nom :</strong> non vérifiée. Un fournisseur d'enregistrement doit la confirmer.</p>
     <p><strong>Compatibilité e-mail :</strong> non vérifiée. Un domaine réellement possédé, des DNS corrects,
       un fournisseur de transport et un test d'envoi/réception sont indispensables.</p>
     <p><a href={selectedEntry.source} target="_blank" rel="noopener noreferrer">Voir la source officielle</a></p>
     <Link className="button" href="/orbit/magnibox/domaines">Gérer les domaines déjà enregistrés</Link>
   </div>}
 </div>;
}
