"use client";

import { useMemo, useState } from "react";
import { createPurchaseOrder } from "@/server/actions/procurement";

type Supplier={id:string;name:string};
type Item={id:string;sku:string;name:string;base_unit:string;tracking_mode:string;default_purchase_price:number;default_tax_rate:number};
type Customer={id:string;name:string};
type Location={id:string;name:string;code:string};

type Line={item_id:string;description:string;purchase_purpose:"resale"|"customer_mandate"|"company_use"|"consumption";beneficiary_customer_id:string;mandate_confirmed:boolean;supplier_document_names_customer:boolean;company_bears_goods_risk:boolean;exact_cost_supported:boolean;mandate_supplier_document_reference:string;quantity_ordered:number;unit:string;unit_price:number;discount_amount:number;additional_cost_amount:number;tax_rate:number};

export function PurchaseOrderForm({suppliers,items,customers}:{suppliers:Supplier[];items:Item[];customers:Customer[]}){
  const [lines,setLines]=useState<Line[]>([]);
  const [supplier,setSupplier]=useState("");
  const [currency,setCurrency]=useState("MGA");
  const [expectedDate,setExpectedDate]=useState("");
  const [notes,setNotes]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const addLine=()=>setLines(v=>[...v,{item_id:"",description:"",purchase_purpose:"resale",beneficiary_customer_id:"",mandate_confirmed:false,supplier_document_names_customer:false,company_bears_goods_risk:true,exact_cost_supported:false,mandate_supplier_document_reference:"",quantity_ordered:1,unit:"unité",unit_price:0,discount_amount:0,additional_cost_amount:0,tax_rate:0}]);
  const update=(i:number,patch:Partial<Line>)=>setLines(v=>v.map((l,n)=>n===i?{...l,...patch}:l));
  const total=useMemo(()=>lines.reduce((s,l)=>(s+l.quantity_ordered*l.unit_price-l.discount_amount+l.additional_cost_amount)*(1+l.tax_rate/100),0),[lines]);
  const submit=async(formData:FormData)=>{
    setBusy(true);setError("");
    try{
      const valid=lines.map(l=>{const item=items.find(i=>i.id===l.item_id);return {...l,description:l.description||item?.name||"",unit:item?.base_unit||l.unit,beneficiary_customer_id:l.beneficiary_customer_id||null,mandate_supplier_document_reference:l.mandate_supplier_document_reference||null};});
      formData.set("supplier_id",supplier);formData.set("currency",currency);formData.set("expected_date",expectedDate);formData.set("notes",notes);formData.set("lines_json",JSON.stringify(valid));
      await createPurchaseOrder(formData);
      window.location.reload();
    }catch(e){setError(e instanceof Error?e.message:"La commande n'a pas pu être enregistrée.");}
    finally{setBusy(false);}
  };
  return <form action={submit} className="form">
    <div className="grid2"><div className="field"><label>Fournisseur</label><select required value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">Sélectionner</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div className="field"><label>Devise</label><input value={currency} maxLength={3} onChange={e=>setCurrency(e.target.value.toUpperCase())} required/></div></div>
    <div className="field"><label>Date prévue</label><input type="date" value={expectedDate} onChange={e=>setExpectedDate(e.target.value)}/></div>
    {lines.map((l,i)=><section className="section" key={i}>
      <div className="pageHead"><h3>Ligne {i+1}</h3><button type="button" className="button small" onClick={()=>setLines(v=>v.filter((_,n)=>n!==i))}>Retirer</button></div>
      <div className="field"><label>Article</label><select required value={l.item_id} onChange={e=>{const item=items.find(x=>x.id===e.target.value);update(i,{item_id:e.target.value,description:item?.name||"",unit:item?.base_unit||"unité",unit_price:Number(item?.default_purchase_price||0),tax_rate:Number(item?.default_tax_rate||0)});}}><option value="">Sélectionner un article</option>{items.map(x=><option key={x.id} value={x.id}>{x.sku} · {x.name}</option>)}</select></div>
      <div className="grid2"><div className="field"><label>Destination</label><select value={l.purchase_purpose} onChange={e=>update(i,{purchase_purpose:e.target.value as Line["purchase_purpose"]})}><option value="resale">Revente (stock entreprise)</option><option value="company_use">Usage interne (bien à qualifier)</option><option value="consumption">Consommable</option><option value="customer_mandate">Achat sous mandat client</option></select></div><div className="field"><label>Quantité</label><input type="number" min="0.0001" step="0.0001" value={l.quantity_ordered} onChange={e=>update(i,{quantity_ordered:Number(e.target.value)})}/></div></div>
      <div className="grid2"><div className="field"><label>Prix unitaire HT</label><input type="number" min="0" step="0.01" value={l.unit_price} onChange={e=>update(i,{unit_price:Number(e.target.value)})}/></div><div className="field"><label>Remise totale HT</label><input type="number" min="0" step="0.01" value={l.discount_amount} onChange={e=>update(i,{discount_amount:Number(e.target.value)})}/></div></div><div className="grid2"><div className="field"><label>Frais associés HT</label><input type="number" min="0" step="0.01" value={l.additional_cost_amount} onChange={e=>update(i,{additional_cost_amount:Number(e.target.value)})}/></div><div className="field"><label>Taxe (%)</label><input type="number" min="0" max="100" step="0.01" value={l.tax_rate} onChange={e=>update(i,{tax_rate:Number(e.target.value)})}/></div></div>
      {l.purchase_purpose==="customer_mandate"&&<><div className="field"><label>Client bénéficiaire</label><select value={l.beneficiary_customer_id} onChange={e=>update(i,{beneficiary_customer_id:e.target.value})}><option value="">Sélectionner</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="field"><label>Référence justificatif fournisseur au nom du client</label><input value={l.mandate_supplier_document_reference} onChange={e=>update(i,{mandate_supplier_document_reference:e.target.value})}/></div><label><input type="checkbox" checked={l.mandate_confirmed} onChange={e=>update(i,{mandate_confirmed:e.target.checked})}/> Mandat confirmé</label><label><input type="checkbox" checked={l.supplier_document_names_customer} onChange={e=>update(i,{supplier_document_names_customer:e.target.checked})}/> Document fournisseur au nom du client</label><label><input type="checkbox" checked={!l.company_bears_goods_risk} onChange={e=>update(i,{company_bears_goods_risk:!e.target.checked})}/> L'entreprise ne porte pas le risque du bien</label><label><input type="checkbox" checked={l.exact_cost_supported} onChange={e=>update(i,{exact_cost_supported:e.target.checked})}/> Coût exact justifié</label></>}
    </section>)}
    <button type="button" className="button" onClick={addLine}>+ Ajouter une ligne</button>
    <div className="field"><label>Notes / conditions</label><textarea value={notes} onChange={e=>setNotes(e.target.value)}/></div>
    <p><strong>Total estimé TTC : {total.toLocaleString("fr-FR")} {currency}</strong></p>
    {error&&<p role="alert" className="error">{error}</p>}
    <button className="button primary" type="submit" disabled={busy||!supplier||!lines.length}>{busy?"Enregistrement…":"Créer et soumettre la commande"}</button>
  </form>;
}
