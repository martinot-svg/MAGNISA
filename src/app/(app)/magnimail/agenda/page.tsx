import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { FormDialog } from "@/components/form-dialog";
import { agendaMonth, parseMGMailAgendaInput, type MGMailAgendaScope } from "@/lib/magnimail/agenda";

const PATH = "/magnimail/agenda";
const ZONES = [
  { value: "Indian/Antananarivo", label: "Madagascar (Antananarivo)" },
  { value: "UTC", label: "UTC" },
  { value: "Africa/Nairobi", label: "Afrique de l'Est (Nairobi)" },
  { value: "Europe/Paris", label: "France (Paris)" },
  { value: "Indian/Mauritius", label: "Maurice" },
];

async function createEvent(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const scope = String(form.get("scope") || "");
  const department = String(form.get("department") || "");
  const canManage = await hasPermission(ctx, "users.manage");
  if (scope === "company" && !["owner", "admin", "director"].includes(ctx.role)) {
    throw new Error("Seule la direction peut publier un événement d'entreprise.");
  }
  if (scope === "service" && !canManage) {
    const { data: self, error } = await ctx.supabase
      .from("organization_members").select("department")
      .eq("organization_id", ctx.organizationId)
      .eq("user_id", ctx.user.id).eq("status", "active").maybeSingle();
    if (error || !self?.department || self.department !== department) {
      throw new Error("Vous ne pouvez organiser que les événements de votre service.");
    }
  }
  const value = parseMGMailAgendaInput({
    scope, department,
    title: String(form.get("title") || ""),
    description: String(form.get("description") || ""),
    startDay: String(form.get("startDay") || ""),
    startTime: String(form.get("startTime") || ""),
    endDay: String(form.get("endDay") || ""),
    endTime: String(form.get("endTime") || ""),
    timeZone: String(form.get("timeZone") || ""),
    reminders: String(form.get("reminders") || ""),
  });
  const { error } = await ctx.supabase.from("mgmail_agenda_events").insert({
    organization_id: ctx.organizationId,
    created_by: ctx.user.id,
    scope: value.scope,
    department: value.department,
    title: value.title,
    description: value.description,
    start_day: value.startDay,
    start_time: value.startTime,
    end_day: value.endDay,
    end_time: value.endTime,
    time_zone: value.timeZone,
    reminder_days: value.reminderDays,
  });
  if (error) throw new Error("Impossible d'enregistrer l'événement dans votre agenda.");
  revalidatePath(PATH);
}

async function cancelEvent(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  const id = String(form.get("eventId") || "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) {
    throw new Error("Identifiant d'événement invalide.");
  }
  const { data, error } = await ctx.supabase.from("mgmail_agenda_events")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id).eq("organization_id", ctx.organizationId)
    .eq("status", "scheduled").select("id").maybeSingle();
  if (error || !data) throw new Error("Événement indisponible ou modification non autorisée.");
  revalidatePath(PATH);
}

function NewEvent({
  scope, department, buttonLabel,
}: {
  scope: MGMailAgendaScope;
  department?: string;
  buttonLabel: string;
}) {
  const kinds: Record<MGMailAgendaScope, string> = {
    personal: "personnel",
    service: "de service",
    company: "d'entreprise",
  };
  return (
    <FormDialog buttonLabel={buttonLabel} title={`Nouvel événement ${kinds[scope]}`}>
      <form className="form" action={createEvent}>
        <input type="hidden" name="scope" value={scope} />
        {scope === "service" && (
          <div className="field">
            <label>Service concerné</label>
            <input name="department" defaultValue={department || ""} required
              minLength={2} maxLength={100} readOnly={!!department} />
          </div>
        )}
        <div className="field">
          <label>Titre de l'événement</label>
          <input name="title" minLength={2} maxLength={180} required
            placeholder="Rendez-vous client, réunion, échéance…" />
        </div>
        <div className="field">
          <label>Description (facultative)</label>
          <textarea name="description" maxLength={5000} rows={3} />
        </div>
        <div className="grid2">
          <div className="field">
            <label>Date de début</label>
            <input type="date" name="startDay" required />
          </div>
          <div className="field">
            <label>Heure de début</label>
            <input type="time" name="startTime" defaultValue="09:00" required />
          </div>
          <div className="field">
            <label>Date de fin</label>
            <input type="date" name="endDay" required />
          </div>
          <div className="field">
            <label>Heure de fin</label>
            <input type="time" name="endTime" defaultValue="10:00" required />
          </div>
        </div>
        <div className="field">
          <label>Fuseau horaire</label>
          <select name="timeZone" defaultValue="Indian/Antananarivo">
            {ZONES.map((zone) => (
              <option key={zone.value} value={zone.value}>{zone.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Rappels personnalisés (jours avant l'événement)</label>
          <input name="reminders" placeholder="7, 2, 1, 0" maxLength={200} />
          <small>Ces délais sont enregistrés. L'expédition automatique des rappels sera activée après validation du moteur d'envoi.</small>
        </div>
        <button className="button primary" type="submit">Ajouter à l'agenda</button>
      </form>
    </FormDialog>
  );
}

const scopeLabels: Record<MGMailAgendaScope, string> = {
  personal: "Personnel",
  service: "Service",
  company: "Entreprise",
};

export default async function MGMailAgenda({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const ctx = await requireOrganization();
  const { month: requestedMonth } = await searchParams;
  const month = agendaMonth(requestedMonth);
  const canManage = await hasPermission(ctx, "users.manage");
  const canCompany = ["owner", "admin", "director"].includes(ctx.role);
  const [member, eventResult] = await Promise.all([
    ctx.supabase.from("organization_members").select("department")
      .eq("organization_id", ctx.organizationId)
      .eq("user_id", ctx.user.id).eq("status", "active").maybeSingle(),
    ctx.supabase.from("mgmail_agenda_events")
      .select("id,created_by,scope,department,title,description,start_day,start_time,end_day,end_time,time_zone,reminder_days,status")
      .eq("organization_id", ctx.organizationId)
      .lte("start_day", month.end).gte("end_day", month.start)
      .neq("status", "cancelled")
      .order("start_day", { ascending: true })
      .order("start_time", { ascending: true }).limit(200),
  ]);
  const events = eventResult.data || [];
  const myDepartment = member.data?.department || "";
  const monthTitle = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(month.start + "T12:00:00Z"));
  const weekdayNames = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const canCancel = (event: (typeof events)[number]) =>
    event.created_by === ctx.user.id || (event.scope !== "personal" && canCompany);

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">MGMail · Organisation</p>
          <h1>Calendrier et agenda</h1>
          <p>Vos rendez-vous personnels, réunions de service et événements d'entreprise.</p>
        </div>
        <Link className="button" href="/magnimail">Retour à MGMail</Link>
      </div>
      <div className="card section">
        <div className="actions">
          <NewEvent scope="personal" buttonLabel="+ Événement personnel" />
          {(myDepartment || canManage) && (
            <NewEvent scope="service" department={canManage ? undefined : myDepartment}
              buttonLabel="+ Événement de service" />
          )}
          {canCompany && <NewEvent scope="company" buttonLabel="+ Événement d'entreprise" />}
        </div>
        <p className="muted">
          Les événements personnels sont privés. Les événements de service sont partagés
          avec les collaborateurs habilités de ce département ; ceux de l'entreprise
          sont visibles par ses membres actifs.
        </p>
      </div>
      {eventResult.error ? (
        <div className="card section" role="alert">
          Calendrier indisponible. Vérifiez l'installation des migrations et vos autorisations.
        </div>
      ) : (
        <>
          <div className="card section">
            <div className="actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Link className="button" href={`/magnimail/agenda?month=${month.previous}`}>Mois précédent</Link>
              <h2 style={{ textTransform: "capitalize" }}>{monthTitle}</h2>
              <Link className="button" href={`/magnimail/agenda?month=${month.next}`}>Mois suivant</Link>
            </div>
            <div style={{ overflowX: "auto", paddingBottom: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(85px, 1fr))", gap: 7, minWidth: 650 }}>
                {weekdayNames.map((name) => (
                  <div key={name} style={{ textAlign: "center", fontWeight: 700, padding: 8 }}>{name}</div>
                ))}
                {Array.from({ length: month.offset }, (_, index) => (
                  <div key={`empty-${index}`} style={{ minHeight: 92 }} />
                ))}
                {month.days.map((day) => {
                  const scheduled = events.filter((event) =>
                    event.start_day <= day.date && event.end_day >= day.date,
                  );
                  return (
                    <div key={day.date} style={{ minHeight: 92, border: "1px solid var(--line, #d6dbe3)", borderRadius: 10, padding: 7 }}>
                      <strong>{day.day}</strong>
                      {scheduled.slice(0, 2).map((event) => (
                        <p key={event.id} title={event.title}
                          style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: "5px 0" }}>
                          {event.title}
                        </p>
                      ))}
                      {scheduled.length > 2 && <small>+{scheduled.length - 2} événement(s)</small>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="card section">
            <h2>Agenda du mois</h2>
            {events.length === 0 ? <p className="muted">Aucun événement visible pour ce mois.</p> : (
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr><th>Date</th><th>Horaire</th><th>Événement</th><th>Calendrier</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{event.start_day}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{event.start_time.slice(0,5)} – {event.end_time.slice(0,5)}</td>
                        <td>
                          <strong>{event.title}</strong>
                          {event.description && <p className="muted">{event.description}</p>}
                          {event.reminder_days.length > 0 && (
                            <small>Rappels prévus : {event.reminder_days.map((d: number) => `J−${d}`).join(", ")} (envoi non activé)</small>
                          )}
                        </td>
                        <td>{scopeLabels[event.scope as MGMailAgendaScope]}{event.department ? ` — ${event.department}` : ""}</td>
                        <td>
                          {canCancel(event) && (
                            <FormDialog buttonLabel="Annuler" title="Annuler cet événement" buttonClassName="button">
                              <form action={cancelEvent} className="form">
                                <input type="hidden" name="eventId" value={event.id} />
                                <p>Confirmer l'annulation de l'événement « {event.title} » ?</p>
                                <button className="button primary" type="submit">Confirmer l'annulation</button>
                              </form>
                            </FormDialog>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
