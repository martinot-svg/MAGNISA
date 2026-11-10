import { randomUUID } from "node:crypto";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission,hasPermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { postStockTransferAction,releaseStockReservationAction } from "@/server/actions/stock-operations";

export default async function StockOperationsPage(){
 const ctx=await requireOrganization();
 await requirePermission(ctx,"inventory.view");
 const canManage=await hasPermission(ctx,"inventory.manage");
 const canManageOrders=await hasPermission(ctx,"orders.manage");
 const {supabase,organizationId}=ctx;
 const [{data:balances=[]},{data:items=[]},{data:locations=[]},{data:reservations=[]},{data:movements=[]} ,{data:transfers=[]}] = await Promise.all([
  supabase.from("stock_available").select("item_id,stock_location_id,stock_bucket,quantity_on_hand,quantity_reserved,quantity_available").eq("organization_id",organizationId),
  supabase.from("catalog_items").select("id,sku,name,base_unit,tracking_mode").eq("organization_id",organizationId).eq("is_active",true).order("name"),
  supabase.from("stock_locations").select("id,code,name,location_kind").eq("organization_id",organizationId).eq("is_active",true).order("name"),
  supabase.from("stock_reservations").select("id,order_id,order_line_id,item_id,stock_location_id,quantity_reserved,quantity_fulfilled,quantity_released,status,created_at").eq("organization_id",organizationId).in("status",["active","partially_fulfilled"]).order("created_at",{ascending:false}).limit(100),
  supabase.from("stock_movements").select("id,item_id,stock_location_id,movement_kind,quantity_delta,unit_cost,currency,source_type,source_id,effective_at,created_by").eq("organization_id",organizationId).order("effective_at",{ascending:false}).limit(100),
  supabase.from("stock_transfers").select("id,transfer_number,source_location_id,destination_location_id,reason,transferred_at,status").eq("organization_id",organizationId).order("transferred_at",{ascending:false}).limit(50),
 ]);
 const itemMap=new Map((items as any[]).map(x=>[x.id,x]));
 const locMap=new Map((locations as any[]).map(x=>[x.id,x]));
 const balanceRows=(balances as any[]).map(b=>({...b,item:itemMap.get(b.item_id),location:locMap.get(b.stock_location_id)}));
 return <>
  <div className="pageHead"><div><p className="eyebrow">Sous-grand livre opérationnel</p><h1>Mouvements & disponibilités</h1><p>Stock physique, réservations, livraisons et transferts enregistrés dans le registre persistant.</p></div></div>
  <section className="section">
   <div className="pageHead"><div><h2>Quantités par emplacement</h2><p>Disponible = physique − réservé. Les commandes fournisseurs ne sont pas du stock physique.</p></div></div>
   {!balanceRows.length?<EmptyState title="Aucun stock enregistré" description="Les quantités apparaîtront après la validation de réceptions ou d'autres mouvements physiques."/>:<div className="tableWrap"><table><thead><tr><th>Article</th><th>Destination</th><th>Emplacement</th><th className="right">Physique</th><th className="right">Réservé</th><th className="right">Disponible</th></tr></thead><tbody>{balanceRows.map((b:any)=><tr key={b.item_id+":"+b.stock_location_id+":"+b.stock_bucket}><td><strong>{b.item?.name||"Article archivé"}</strong><div className="muted">{b.item?.sku}</div></td><td>{b.stock_bucket==="resale"?"Revente":b.stock_bucket==="company_use"?"Usage interne":"Consommation"}</td><td>{b.location?.code} · {b.location?.name}</td><td className="right">{Number(b.quantity_on_hand).toLocaleString("fr-FR")} {b.item?.base_unit}</td><td className="right">{Number(b.quantity_reserved).toLocaleString("fr-FR")}</td><td className="right"><strong>{Number(b.quantity_available).toLocaleString("fr-FR")}</strong></td></tr>)}</tbody></table></div>}
  </section>
  {canManage&&<section className="section card"><h2>Transfert entre emplacements</h2><p className="muted">Le transfert génère deux mouvements compensés : sortie de l'emplacement source et entrée à destination. Le stock total de l'entreprise ne change pas.</p>
   <form action={postStockTransferAction} className="form">
    <div className="grid2"><div className="field"><label>Destination du stock</label><select name="stock_bucket" required defaultValue="resale"><option value="resale">Marchandises destinées à la revente</option><option value="company_use">Équipements / biens d'usage interne</option><option value="consumption">Consommables</option></select></div><div className="field"><label>Article</label><select name="item_id" required defaultValue=""><option value="" disabled>Choisir</option>{(items as any[]).filter(i=>i.tracking_mode==="quantity").map(i=><option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}</select></div><div className="field"><label>Quantité</label><input name="quantity" type="number" min="0.0001" step="0.0001" required/></div></div>
    <div className="grid2"><div className="field"><label>Depuis</label><select name="source_location_id" required defaultValue=""><option value="" disabled>Choisir</option>{(locations as any[]).map(l=><option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></div><div className="field"><label>Vers</label><select name="destination_location_id" required defaultValue=""><option value="" disabled>Choisir</option>{(locations as any[]).map(l=><option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></div></div>
    <div className="grid2"><div className="field"><label>Coût unitaire de référence</label><input name="unit_cost" type="number" min="0" step="0.01" defaultValue="0"/></div><div className="field"><label>Motif</label><input name="reason" minLength={3} maxLength={500} required placeholder="Ex. Réapprovisionnement du point de vente"/></div></div>
    <input type="hidden" name="request_key" value={randomUUID()}/><button className="button primary">Valider le transfert</button>
   </form>
  </section>}
  <section className="section"><div className="pageHead"><div><h2>Réservations actives</h2><p>Une réservation immobilise du disponible mais ne diminue pas le stock physique.</p></div></div>
   {!reservations.length?<EmptyState title="Aucune réservation active" description="Les réservations clients s'afficheront ici."/>:<div className="tableWrap"><table><thead><tr><th>Commande</th><th>Article</th><th>Emplacement</th><th>Réservé</th><th>Livré</th><th>Restant réservé</th><th>Action</th></tr></thead><tbody>{(reservations as any[]).map(r=><tr key={r.id}><td>{r.order_id.slice(0,8)}</td><td>{itemMap.get(r.item_id)?.name||r.item_id}</td><td>{locMap.get(r.stock_location_id)?.name||r.stock_location_id}</td><td>{Number(r.quantity_reserved)}</td><td>{Number(r.quantity_fulfilled)}</td><td>{Number(r.quantity_reserved)-Number(r.quantity_fulfilled)-Number(r.quantity_released)}</td><td>{canManageOrders&&<form action={releaseStockReservationAction} className="actions"><input type="hidden" name="reservation_id" value={r.id}/><input type="hidden" name="request_key" value={randomUUID()}/><input name="quantity" aria-label="Quantité à libérer" type="number" min="0.0001" max={Number(r.quantity_reserved)-Number(r.quantity_fulfilled)-Number(r.quantity_released)} step="0.0001" defaultValue={Number(r.quantity_reserved)-Number(r.quantity_fulfilled)-Number(r.quantity_released)}/><button className="button small">Libérer</button></form>}</td></tr>)}</tbody></table></div>}
  </section>
  <section className="section"><div className="pageHead"><div><h2>Derniers mouvements physiques</h2><p>Registre append-only, origine métier et date d'effet.</p></div></div>
   {!movements.length?<EmptyState title="Aucun mouvement" description="Les mouvements validés apparaîtront ici."/>:<div className="tableWrap"><table><thead><tr><th>Date d'effet</th><th>Article</th><th>Emplacement</th><th>Nature</th><th className="right">Variation</th><th>Origine</th></tr></thead><tbody>{(movements as any[]).map(m=><tr key={m.id}><td>{new Date(m.effective_at).toLocaleString("fr-FR")}</td><td>{itemMap.get(m.item_id)?.name||m.item_id}</td><td>{locMap.get(m.stock_location_id)?.name||m.stock_location_id}</td><td>{m.movement_kind}</td><td className="right">{Number(m.quantity_delta)>0?"+":""}{Number(m.quantity_delta).toLocaleString("fr-FR")}</td><td>{m.source_type} · {String(m.source_id).slice(0,8)}</td></tr>)}</tbody></table></div>}
  </section>
  <section className="section"><div className="pageHead"><div><h2>Transferts enregistrés</h2><p>Historique des transferts entre emplacements.</p></div></div>
   {!transfers.length?<EmptyState title="Aucun transfert" description="Les transferts validés apparaîtront ici."/>:<div className="tableWrap"><table><thead><tr><th>Référence</th><th>De</th><th>Vers</th><th>Motif</th><th>Date</th><th>Statut</th></tr></thead><tbody>{(transfers as any[]).map(t=><tr key={t.id}><td>{t.transfer_number}</td><td>{locMap.get(t.source_location_id)?.name||"—"}</td><td>{locMap.get(t.destination_location_id)?.name||"—"}</td><td>{t.reason}</td><td>{new Date(t.transferred_at).toLocaleString("fr-FR")}</td><td>{t.status}</td></tr>)}</tbody></table></div>}
  </section>
 </>;
}
