"use client";
import { useMemo, useState } from "react";
import { calculateMvolaTransfer, MVOLA_RATE_VERSION, type MvolaFeeOperation } from "@/lib/mvola-tariffs";

type Account = {id:string;name:string;type:string;details?:unknown};
type Props={accounts:Account[];requestKey:string;action:(fd:FormData)=>void|Promise<void>};
function category(account:Account|undefined) { const d=account?.details as Record<string,unknown>|undefined;return String(d?.account_type??"personal"); }
function tariff(source:Account|undefined,dest:Account|undefined):MvolaFeeOperation|null {
 if(!source||!dest||source.id===dest.id)return null;
 const sm=source.type==="mobile_money"&&source.name.toLowerCase()==="mvola";
 const dm=dest.type==="mobile_money"&&dest.name.toLowerCase()==="mvola";
 if(sm&&dest.type==="cash")return "withdrawal";
 if(source.type==="cash"&&dm)return "deposit";
 if(sm&&dest.type==="bank")return dest.name.toLowerCase().includes("bni")?"bank_to_bni":"bank_other";
 if(source.type==="bank"&&dm){
   if(source.name.toLowerCase().includes("bni")||category(dest)==="personal")return "deposit";
   return "bank_other";
 }
 if(sm&&dest.type==="mobile_money")return category(source)==="business"?"enterprise_transfer":"transfer_other_operator";
 if(source.type==="mobile_money"&&dm)return null; // source provider rate not in MVola catalogue
 if(sm&&dm)return category(source)==="business"?"enterprise_transfer":"transfer_mvola";
 return null;
}
export function InternalTransferForm({accounts,requestKey,action}:Props){
 const [source,setSource]=useState("");const [destination,setDestination]=useState("");
 const [mode,setMode]=useState<"included"|"added">("included");const [amount,setAmount]=useState("");
 const [date,setDate]=useState("");const [reference,setReference]=useState("");
 const src=accounts.find(a=>a.id===source),dst=accounts.find(a=>a.id===destination);
 const operation=tariff(src,dst);const n=Number(amount);
 const calculated=useMemo(()=>operation?calculateMvolaTransfer(operation,n,mode):null,[n,mode,operation]);
 const supported=!!calculated&&!!src&&!!dst&&src.id!==dst.id;
 const fmt=(value:number)=>new Intl.NumberFormat("fr-FR").format(value)+" Ar";
 return <form action={action} className="card form">
  <h3>Enregistrer un débit confirmé</h3>
  <input type="hidden" name="request_key" value={requestKey}/>
  <div className="field"><label htmlFor="internal-source">Compte source</label><select id="internal-source" name="source" value={source} onChange={e=>setSource(e.target.value)} required><option value="">Sélectionner</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}</select></div>
  <div className="field"><label htmlFor="internal-destination">Compte destinataire</label><select id="internal-destination" name="destination" value={destination} onChange={e=>setDestination(e.target.value)} required><option value="">Sélectionner</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}</select></div>
  <div className="field"><label htmlFor="internal-mode">Mode de transfert</label><select id="internal-mode" name="fee_mode" value={mode} onChange={e=>setMode(e.target.value as "included"|"added")}><option value="included">Montant brut - frais déduits</option><option value="added">Montant net - frais ajoutés</option></select></div>
  <div className="field"><label htmlFor="internal-amount">Montant de référence (Ar)</label><input id="internal-amount" name="reference_amount" type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)} required/></div>
  <input type="hidden" name="source_debit" value={calculated?.debit??""}/>
  <input type="hidden" name="destination_credit" value={calculated?.credit??""}/>
  <input type="hidden" name="operator_fee" value={calculated?.fee??""}/>
  <div className="card"><h4>Calcul automatique - barème {MVOLA_RATE_VERSION}</h4>
   <p>Frais estimés : <strong>{calculated?fmt(calculated.fee):"-"}</strong></p>
   <p>Débit du compte source : <strong>{calculated?fmt(calculated.debit):"-"}</strong></p>
   <p>Crédit prévu au destinataire : <strong>{calculated?fmt(calculated.credit):"-"}</strong></p>
   {!operation&&source&&destination&&<p className="error">Tarif de cet opérateur ou de ce parcours non disponible. Aucun frais ne sera inventé.</p>}
   {operation==="bank_other"&&mode==="included"&&<p className="error">Assiette du taux de 1 % à confirmer pour les frais inclus. Calcul et enregistrement indisponibles pour ce cas tant que la règle n'est pas vérifiée.</p>}
   <small>{mode==="included"?"Le montant de référence est le total débité, frais inclus.":"Le montant de référence est le net garanti au destinataire, frais ajoutés."}</small><small>Vérifie que les frais affichés correspondent exactement au débit réel. Cette fonction ne détecte pas les prélèvements chez l'opérateur.</small>
  </div>
  <div className="field"><label htmlFor="internal-date">Date du débit confirmé</label><input id="internal-date" type="date" name="date" value={date} onChange={e=>setDate(e.target.value)} required/></div>
  <div className="field"><label htmlFor="internal-ref">Référence réelle du débit</label><input id="internal-ref" name="reference" value={reference} onChange={e=>setReference(e.target.value)} minLength={2} required/></div>
  <label><input type="checkbox" required/> Je confirme que le débit et les frais calculés correspondent au justificatif réel.</label>
  <button type="submit" className="button primary" disabled={!supported||!date||reference.trim().length<2}>Enregistrer - placer en transit</button>
 </form>;
}
