import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { FormDialog } from "@/components/form-dialog";
import { EmptyState } from "@/components/empty-state";
import {
  cancelResourceReservation,
  createReservableResource,
  createResourceReservation,
  updateResourceReservationPeriod,
} from "@/server/actions/resource-reservations";

const TYPE_LABELS: Record<string,string> = {
  room: "Salle", vehicle: "Véhicule", equipment: "Équipement",
  staff: "Personnel", other: "Autre",
};

function displayDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium", timeStyle: "short", timeZone: timezone,
  }).format(new Date(value));
}

export default async function Reservations() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "orders.manage");
  const { supabase, organizationId } = ctx;

  const [{ data: resources = [] }, { data: reservations = [] }, { data: customers = [] }, { data: services = [] }] =
    await Promise.all([
      supabase.from("reservable_resources").select("*").eq("organization_id",organizationId).eq("is_active",true).order("name"),
      supabase.from("resource_reservations").select("*").eq("organization_id",organizationId).in("status",["held","confirmed"]).gte("start_at",new Date().toISOString()).order("start_at").limit(100),
      supabase.from("customers").select("id,name").eq("organization_id",organizationId).eq("is_active",true).order("name").limit(500),
      supabase.from("services").select("id,name").eq("organization_id",organizationId).eq("is_active",true).order("name").limit(500),
    ]);

  const resourceNames = new Map(resources.map((r:any) => [r.id,r.name]));
  const customerNames = new Map(customers.map((c:any) => [c.id,c.name]));

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Réservations de ressources</h1>
          <p>Planifie les salles, véhicules, équipements et ressources de l'entreprise. Les chevauchements sont bloqués directement par PostgreSQL.</p>
        </div>
        <div className="actions">
          <FormDialog title="Ajouter une ressource" buttonLabel="+ Ressource">
            <form action={createReservableResource} className="form">
              <div className="field"><label>Nom</label><input name="name" required minLength={2} maxLength={180} /></div>
              <div className="field"><label>Type</label><select name="resource_type" defaultValue="room">
                <option value="room">Salle</option><option value="vehicle">Véhicule</option><option value="equipment">Équipement</option><option value="staff">Personnel</option><option value="other">Autre</option>
              </select></div>
              <div className="field"><label>Capacité (facultatif)</label><input name="capacity" type="number" min="1" step="1" /></div>
              <div className="field"><label>Description</label><textarea name="description" maxLength={2000} /></div>
              <button className="button primary" type="submit">Créer la ressource</button>
            </form>
          </FormDialog>
          {resources.length > 0 && <FormDialog title="Nouvelle réservation" buttonLabel="+ Réserver">
            <form action={createResourceReservation} className="form">
              <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
              <div className="field"><label>Ressource</label><select name="resource_id" required defaultValue="">
                <option value="" disabled>Choisir une ressource</option>{resources.map((r:any)=><option key={r.id} value={r.id}>{r.name} · {TYPE_LABELS[r.resource_type] || "Autre"}</option>)}
              </select></div>
              <div className="field"><label>Client (facultatif)</label><select name="customer_id" defaultValue=""><option value="">Aucun client associé</option>{customers.map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="field"><label>Prestation (facultatif)</label><select name="service_id" defaultValue=""><option value="">Aucune prestation associée</option>{services.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div className="field"><label>Début (ISO avec décalage UTC)</label><input name="start_at" type="text" required placeholder="2026-12-01T09:00:00+03:00" /></div>
              <div className="field"><label>Fin (ISO avec décalage UTC)</label><input name="end_at" type="text" required placeholder="2026-12-01T11:00:00+03:00" /></div>
              <div className="field"><label>Fuseau de référence</label><input name="timezone_name" defaultValue="Indian/Antananarivo" required /></div>
              <div className="field"><label>Notes</label><textarea name="notes" maxLength={4000} /></div>
              <p className="muted">Saisis une date avec son décalage, par exemple +03:00. Les réservations passées ou chevauchantes seront refusées.</p>
              <button className="button primary" type="submit">Confirmer la réservation</button>
            </form>
          </FormDialog>}
        </div>
      </div>

      <section className="section">
        <h2>Ressources actives ({resources.length})</h2>
        {!resources.length ? <EmptyState title="Aucune ressource" description="Ajoute une salle, un véhicule ou un équipement pour commencer les réservations." /> :
          <div className="card"><ul>{resources.map((r:any)=><li key={r.id}>{r.name} <span className="muted">· {TYPE_LABELS[r.resource_type] || "Autre"}{r.capacity ? ` · Capacité ${r.capacity}` : ""}</span></li>)}</ul></div>}
      </section>

      <section className="section">
        <h2>Réservations à venir ({reservations.length})</h2>
        {!reservations.length ? <EmptyState title="Aucune réservation active" description="Les réservations confirmées apparaîtront ici." /> :
          <div style={{display:"grid",gap:12}}>{reservations.map((r:any)=><article className="card" key={r.id}>
            <div className="pageHead" style={{marginBottom:8}}><div>
              <h3>{resourceNames.get(r.resource_id) || "Ressource"}</h3>
              <p className="muted">{displayDate(r.start_at,r.timezone_name)} – {displayDate(r.end_at,r.timezone_name)} ({r.timezone_name})</p>
              <p>{r.customer_id ? customerNames.get(r.customer_id) || "Client associé" : "Sans client"} · {r.status === "held" ? "En attente" : "Confirmée"}</p>
              {r.notes && <p className="muted">{r.notes}</p>}
            </div></div>
            <FormDialog title="Modifier la période" buttonLabel="Modifier la période" buttonClassName="button">
              <form action={updateResourceReservationPeriod} className="form">
                <input type="hidden" name="id" value={r.id} />
                <div className="field"><label>Nouveau début (ISO avec décalage UTC)</label><input name="start_at" type="text" required placeholder="2026-12-01T09:00:00+03:00" /></div>
                <div className="field"><label>Nouvelle fin (ISO avec décalage UTC)</label><input name="end_at" type="text" required placeholder="2026-12-01T11:00:00+03:00" /></div>
                <div className="field"><label>Fuseau de référence</label><input name="timezone_name" defaultValue={r.timezone_name} required /></div>
                <button className="button primary" type="submit">Enregistrer la période</button>
              </form>
            </FormDialog>
            <FormDialog title="Annuler la réservation" buttonLabel="Annuler la réservation" buttonClassName="button ghost">
              <form action={cancelResourceReservation} className="form">
                <input type="hidden" name="id" value={r.id} />
                <div className="field"><label>Motif</label><textarea name="reason" required minLength={3} maxLength={1000} /></div>
                <button className="button danger" type="submit">Confirmer l'annulation</button>
              </form>
            </FormDialog>
          </article>)}</div>}
      </section>
    </>
  );
}
