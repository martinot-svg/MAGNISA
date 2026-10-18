"use client";
import {useState} from "react";
import {defaultDocumentTheme,parseDocumentTheme,type DocumentTheme} from "@/lib/document-theme";
export function BrandingThemeEditor({initial,company}:{initial:unknown;company:string}){
 const [draft,setDraft]=useState<DocumentTheme>(()=>parseDocumentTheme(initial));
 const [reset,setReset]=useState(false);
 const set=<K extends keyof DocumentTheme>(k:K,v:DocumentTheme[K])=>setDraft(old=>({...old,[k]:v}));
 const colors=[["primaryColor","Couleur principale"],["secondaryColor","Secondaire"],["accentColor","Accent"],["textColor","Texte"],["headingColor","Titres"],["borderColor","Bordures"],["tableHeaderColor","En-tête du tableau"],["backgroundColor","Arrière-plan"]] as const;
 return <div className="grid2"><div className="card"><h2>Charte documentaire globale</h2><p className="muted">Modifications en cours : aperçu ci-contre. Elles ne seront enregistrées qu'après validation.</p><div className="form">
 <div className="field"><label>Style</label><select name="style" form="brand-theme-form" value={draft.style} onChange={e=>set("style",e.target.value as DocumentTheme["style"])}>{[["classic","Classique"],["modern","Moderne"],["minimal","Minimaliste"],["institutional","Institutionnel"]].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></div>
 <div className="field"><label>Police PDF</label><select name="fontFamily" form="brand-theme-form" value={draft.fontFamily} onChange={e=>set("fontFamily",e.target.value as DocumentTheme["fontFamily"])}>{["Helvetica","Times-Roman","Courier"].map(p=><option key={p}>{p}</option>)}</select></div>
 <div className="grid2">{colors.map(([key,label])=><div className="field" key={key}><label>{label}</label><input type="color" form="brand-theme-form" name={key} value={draft[key]} onChange={e=>set(key,e.target.value)}/></div>)}</div>
 <div className="field"><label>Marge du document (points)</label><input type="number" form="brand-theme-form" name="pageMargin" min="28" max="58" value={draft.pageMargin} onChange={e=>set("pageMargin",Number(e.target.value))}/></div>
 <div className="field"><label>Position du logo</label><select form="brand-theme-form" name="logoPosition" value={draft.logoPosition} onChange={e=>set("logoPosition",e.target.value as DocumentTheme["logoPosition"])}><option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option></select></div>
 <div className="field"><label>Largeur du logo (points)</label><input form="brand-theme-form" name="logoWidth" type="number" min="40" max="120" value={draft.logoWidth} onChange={e=>set("logoWidth",Number(e.target.value))}/></div>
 <label><input form="brand-theme-form" name="showPageNumbers" type="checkbox" checked={draft.showPageNumbers} onChange={e=>set("showPageNumbers",e.target.checked)}/> Afficher le numéro de page</label>
 <button type="button" className="button" onClick={()=>{setDraft(parseDocumentTheme(initial));setReset(false)}}>Annuler les modifications</button>
 <button type="button" className="button" onClick={()=>setReset(true)}>Restaurer le style par défaut</button>
 {reset&&<div role="alert"><p>Confirmer la réinitialisation de la charte visuelle ?</p><button className="button" type="button" onClick={()=>setReset(false)}>Annuler</button> <button className="button" type="button" onClick={()=>{setDraft({...defaultDocumentTheme});setReset(false)}}>Confirmer</button></div>}
 </div></div><div className="card"><h2>Aperçu en cours de modification</h2><p className="muted">Sans numéro, client ni montant fictifs. Il ne s'agit pas d'un document officiel.</p><div style={{background:draft.backgroundColor,color:draft.textColor,border:"1px solid "+draft.borderColor,padding:24,fontFamily:draft.fontFamily}}>
 <div style={{textAlign:draft.logoPosition,fontSize:20,fontWeight:700,color:draft.headingColor}}>{company||"Identité de l'entreprise non renseignée"}</div><div style={{height:3,background:draft.primaryColor,margin:"16px 0"}}/><p style={{fontSize:16,fontWeight:700,color:draft.headingColor}}>Aperçu de la présentation</p><p>Les champs réels du document seront intégrés lors de sa génération.</p><div style={{background:draft.tableHeaderColor,padding:10,border:"1px solid "+draft.borderColor}}>Libellé <span style={{float:"right"}}>Montant</span></div><div style={{padding:10,borderBottom:"1px solid "+draft.borderColor}}>Aucune donnée chargée</div><p style={{color:draft.secondaryColor,fontSize:12}}>Couleurs et typographie : aperçu non enregistré</p>
 </div></div></div>;
}
