"use client";
import { useState } from "react";
type Type = "bank" | "cash" | "mobile_money" | "cheque_clearing";
const types: {value: Type; label:string; description:string}[] = [
 {value:"bank",label:"Banque",description:"Comptes bancaires"},
 {value:"cash",label:"Caisse",description:"Gestion des espèces"},
 {value:"mobile_money",label:"Mobile Money",description:"MVola, Orange Money, Airtel Money"},
 {value:"cheque_clearing",label:"Chèques à encaisser",description:"Chèques reçus en attente"}
];
const services: Record<string,string>={"MVola":"Yas","Orange Money":"Orange","Airtel Money":"Airtel"};
export function FinancialAccountCreationFields() {
 const [page,setPage]=useState(1);
 const [type,setType]=useState<Type>("bank");
 const [service,setService]=useState("MVola");
 const [bank,setBank]=useState("");
 const [bankType,setBankType]=useState("");
 const [cashType,setCashType]=useState("");
 const [category,setCategory]=useState("");
 const [phone,setPhone]=useState("");
 const [accountNumber,setAccountNumber]=useState("");
 const [holder,setHolder]=useState("");
 const [name,setName]=useState("");
 const [responsible,setResponsible]=useState("");
 const [otherBank,setOtherBank]=useState("");
 const [currency,setCurrency]=useState("MGA");
 const valid= type==="mobile_money" ? /^\+261\d{9}$/.test(phone.replace(/[ .-]/g,""))&&!!category :
 type==="bank" ? !!bank&&(bank!=="Autre"||!!otherBank.trim())&&!!bankType&&!!holder.trim()&&!!accountNumber.trim():
 type==="cash" ? !!name.trim()&&!!cashType&&!!responsible.trim() : !!name.trim();
 return <div className="form">
  <p className="muted">Étape {page} sur 2 : {page===1?"Choisir le type de compte":"Informations du compte"}</p>
  <div style={{display:"flex",gap:6,marginBottom:14}}><span style={{height:5,flex:1,background:"#1478bd",borderRadius:4}}/><span style={{height:5,flex:1,background:page===2?"#1478bd":"#d9dee5",borderRadius:4}}/></div>
  {page===1 ? <>
   <div className="field"><label>Type de compte de trésorerie *</label>
    <div style={{display:"grid",gap:10}}>
    {types.map(t=><label key={t.value} style={{display:"flex",alignItems:"center",gap:12,padding:14,border:"1px solid "+(type===t.value?"#1478bd":"#d9dee5"),borderRadius:10,cursor:"pointer"}}>
     <input type="radio" name="account_type_selection" checked={type===t.value} onChange={()=>setType(t.value)}/>
     <span><strong>{t.label}</strong><small style={{display:"block",opacity:.7}}>{t.description}</small></span>
    </label>)}</div>
   </div>
   <button type="button" className="button primary" onClick={()=>setPage(2)}>Continuer →</button>
  </> : <>
   <input type="hidden" name="type" value={type}/>
   <p className="muted">Compte : {types.find(t=>t.value===type)?.label}</p>
   {type==="mobile_money" ? <>
    <div className="field"><label htmlFor="mm-service">Nom du compte *</label><select id="mm-service" name="service" value={service} onChange={e=>setService(e.target.value)}><option>MVola</option><option>Orange Money</option><option>Airtel Money</option></select></div>
    <div className="field"><label>Opérateur (automatique)</label><input value={services[service]} readOnly aria-label="Opérateur"/><input type="hidden" name="operator" value={services[service]}/></div>
    <div className="field"><label htmlFor="mm-phone">Numéro associé *</label><input id="mm-phone" name="phone" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+261 XX XXX XXX" required/></div>
    <div className="field"><label htmlFor="mm-cat">Type de compte *</label><select id="mm-cat" name="account_category" value={category} onChange={e=>setCategory(e.target.value)} required><option value="">Sélectionner</option><option value="personal">Particulier classique</option><option value="business">Entreprise</option><option value="merchant">Marchand</option></select></div>
   </> : type==="bank" ? <>
    <div className="field"><label htmlFor="bank-name">Nom de la banque *</label><select id="bank-name" name="bank" value={bank} onChange={e=>setBank(e.target.value)} required><option value="">Sélectionner</option>{["BNI Madagascar","BOA Madagascar","BRED Madagasikara","BMOI","Société Générale Madagasikara","MCB Madagascar","SBM Madagascar","AccèsBanque Madagascar","Autre"].map(b=><option key={b}>{b}</option>)}</select></div>
    {bank==="Autre"&&<div className="field"><label>Autre banque *</label><input name="other_bank" value={otherBank} onChange={e=>setOtherBank(e.target.value)} required/></div>}
    <div className="field"><label>Type de compte bancaire *</label><select name="bank_type" value={bankType} onChange={e=>setBankType(e.target.value)} required><option value="">Sélectionner</option><option value="current">Courant / à vue</option><option value="savings">Épargne</option><option value="term">Dépôt à terme</option><option value="other">Autre</option></select></div>
    <div className="field"><label>Titulaire du compte *</label><input name="holder" value={holder} onChange={e=>setHolder(e.target.value)} required/></div>
    <div className="field"><label>Numéro du compte *</label><input name="account_number" value={accountNumber} onChange={e=>setAccountNumber(e.target.value)} required/></div>
    <div className="field"><label>Agence bancaire</label><input name="branch"/></div>
    <div className="field"><label>RIB / IBAN (facultatif)</label><input name="rib"/></div>
   </> : type==="cash" ? <>
    <div className="field"><label>Nom de la caisse *</label><input name="name" value={name} onChange={e=>setName(e.target.value)} required/></div>
    <div className="field"><label>Type de caisse *</label><select name="cash_type" value={cashType} onChange={e=>setCashType(e.target.value)} required><option value="">Sélectionner</option><option value="main">Principale</option><option value="secondary">Secondaire</option><option value="petty">Petite caisse / menues dépenses</option><option value="sales">Point de vente</option><option value="other">Autre</option></select></div>
    <div className="field"><label>Responsable *</label><input name="responsible" value={responsible} onChange={e=>setResponsible(e.target.value)} required/></div>
    <div className="field"><label>Emplacement</label><input name="location"/></div>
   </> : <>
    <div className="field"><label>Nom du compte *</label><input name="name" value={name} onChange={e=>setName(e.target.value)} required/></div>
    <div className="field"><label>Catégorie de suivi *</label><select name="cheque_category" required><option value="clients">Chèques reçus des clients</option><option value="other">Autres chèques reçus</option><option value="all">Tous les chèques à encaisser</option></select></div>
    <div className="field"><label>Responsable du suivi</label><input name="responsible"/></div>
   </>}
   <div className="field"><label>Devise *</label><select name="currency" value={currency} onChange={e=>setCurrency(e.target.value)} required><option value="MGA">Ariary (MGA)</option><option value="EUR">Euro (EUR)</option><option value="USD">Dollar américain (USD)</option></select></div>
   {type!=="mobile_money"&&<div className="field"><label>Description (facultatif)</label><textarea name="description" rows={2}/></div>}
   <div style={{display:"flex",gap:10,flexWrap:"wrap"}}><button className="button" type="button" onClick={()=>setPage(1)}>← Retour</button><button className="button primary" type="submit" disabled={!valid}>Créer le compte</button></div>
  </>}
 </div>;
}