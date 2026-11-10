import { requireOrganization } from "@/lib/current-org";
import { requirePermission,hasPermission } from "@/lib/permissions";
import { FormDialog } from "@/components/form-dialog";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { PurchaseOrderForm } from "@/components/purchase-order-form";
import { postPurchaseReceipt } from "@/server/actions/procurement";

export default async function Approvisionnements(){
  const ctx=await requireOrganization();
  await requirePermission(ctx,"inventory.view");
  const canManage=await hasPermission(ctx,"inventory.manage");
  const {supabase,organizationId}=ctx;
  const [{data:orders=[]},{data:suppliers=[]},{data:items=[]},{data:customers=[]},{data:locations=[]},{data:org}]=await Promise.all([
    supabase.from("purchase_orders").select("id,number,status,order_date,expected_date,currency,total,supplier_id,notes,suppliers(name),purchase_order_lines(id,item_id,description,purchase_purpose,quantity_ordered,quantity_received,unit,unit_price,tax_rate,mandate_confirmed,supplier_document_names_customer,company_bears_goods_risk,exact_cost_supported,mandate_supplier_document_reference,catalog_items(name,sku,tracking_mode))").eq("organization_id",organizationId).order("created_at",{ascending:false}),
    supabase.from("suppliers").select("id,name").eq("organization_id",organizationId).order("name"),
    supabase.from("catalog_items").select("id,sku,name,base_unit,tracking_mode,default_purchase_price,default_tax_rate").eq("organization_id",organizationId).eq("is_active",true).order("name"),
    supabase.from("customers").select("id,name").eq("organization_id",organizationId).order("name"),
    supabase.from("stock_locations").select("id,code,name").eq("organization_id",organizationId).eq("is_active",true).order("name"),
    supabase.from("organizations").select("currency").eq("id",organizationId).single(),
  ]);
  const currency=org?.currency||"MGA";
  return <>
    <div className="pageHead"><div><h1>Approvisionnements</h1><p>Commandes fournisseurs, réceptions partielles et entrées de stock validées.</p></div>{canManage&&<FormDialog title="Nouvelle commande fournisseur" buttonLabel="+ Nouvelle commande"><PurchaseOrderForm suppliers={suppliers as any[]} items={items as any[]} customers={customers as any[]} locations={locations as any[]}/></FormDialog>}</div>
    {!orders.length?<EmptyState title="Aucune commande fournisseur" description="Crée une commande à partir du catalogue général. La commande ne modifie pas le stock physique."/ >:<div className="tableWrap"><table><thead><tr><th>Commande</th><th>Fournisseur</th><th>État</th><th>Date</th><th className="right">Total</th><th>Lignes / réception</th></tr></thead><tbody>
      {(orders as any[]).map(order=><tr key={order.id}><td><strong>{order.number}</strong></td><td>{order.suppliers?.name||"—"}</td><td>{({draft:"Brouillon",submitted:"En attente",partially_received:"Partiellement reçue",received:"Reçue",cancelled:"Annulée"} as any)[order.status]||order.status}</td><td>{order.order_date}</td><td className="right">{money(Number(order.total),order.currency||currency)}</td><td><div className="stack">{(order.purchase_order_lines||[]).map((line:any)=><div key={line.id}><strong>{line.catalog_items?.name||line.description}</strong> · {Number(line.quantity_received)} / {Number(line.quantity_ordered)} {line.unit}
        {canManage&&["submitted","partially_received"].includes(order.status)&&<FormDialog title={"Réception · "+line.description} buttonLabel="Réceptionner"><form action={postPurchaseReceipt} className="form"><input type="hidden" name="purchase_order_id" value={order.id}/><input type="hidden" name="purchase_order_line_id" value={line.id}/><div className="field"><label>Quantité reçue maintenant</label><input name="quantity_received" type="number" min="0.0001" max={Number(line.quantity_ordered)-Number(line.quantity_received)} step="0.0001" required/></div><div className="field"><label>Coût unitaire réel</label><input name="unit_cost" type="number" min="0" step="0.01" defaultValue={line.unit_price} required/></div>{line.purchase_purpose!=="customer_mandate"&&<div className="field"><label>Emplacement</label><select name="stock_location_id" defaultValue={(locations as any[])[0]?.id||""} required>{(locations as any[]).map(l=><option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></div>}<div className="field"><label>Référence bon de livraison fournisseur</label><input name="supplier_delivery_reference" maxLength={160}/></div><button className="button primary" type="submit">Valider la réception</button></form></FormDialog>}
      </div>)}</div></td></tr>)}
    </tbody></table></div>}
    <p className="muted">Une réception validée crée un mouvement de stock uniquement pour les biens appartenant à l'entreprise et suivis en quantité. Elle ne crée aucune écriture de facture fournisseur.</p>
  </>;
}
