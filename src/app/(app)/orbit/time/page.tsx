import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { orbitMonth } from "@/lib/orbit/calendar";

export default async function OrbitTimePage({
  searchParams,
}: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireOrganization();
  const permitted = await hasPermission(ctx, "sales.view");
  if (!permitted) return (
    <div className="card section" role="alert">
      Vous n'avez pas l'autorisation de consulter ce calendrier de projets.
    </div>
  );
  const { month: monthParam } = await searchParams;
  const month = orbitMonth(monthParam);
  const { data: projects, error } = await ctx.supabase.from("projects")
    .select("id,name,start_date,end_date,status")
    .eq("organization_id", ctx.organizationId)
    .lte("start_date", month.last)
    .gte("end_date", month.first)
    .neq("status", "cancelled")
    .order("start_date", { ascending: true })
    .limit(150);
  const weekdays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const monthTitle = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(month.first + "T12:00:00Z"));
  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Magnisa Orbit · Gestion du temps</p>
          <h1>Magnisa Time</h1>
          <p>Calendrier des périodes de projets actuellement enregistrées dans MAGNISA.</p>
        </div>
      </div>
      {error ? <div className="card section" role="alert">Le calendrier des projets est indisponible.</div> : (
        <div className="card section">
          <div className="actions" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <Link className="button" href={`/orbit/time?month=${month.previous}`}>Mois précédent</Link>
            <h2 style={{ textTransform: "capitalize" }}>{monthTitle}</h2>
            <Link className="button" href={`/orbit/time?month=${month.next}`}>Mois suivant</Link>
          </div>
          <div style={{ overflowX: "auto", paddingBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(88px,1fr))", gap: 7, minWidth: 660 }}>
              {weekdays.map(day => <strong key={day} style={{ textAlign: "center" }}>{day}</strong>)}
              {Array.from({ length: month.offset }, (_, i) => <div key={`blank-${i}`} />)}
              {month.days.map(day => {
                const assigned = (projects || []).filter(project =>
                  project.start_date <= day.date && project.end_date >= day.date,
                );
                return (
                  <div key={day.date} style={{ minHeight: 88, border: "1px solid var(--line, #d6dbe3)", padding: 7, borderRadius: 10 }}>
                    <strong>{day.day}</strong>
                    {assigned.slice(0, 2).map(project => (
                      <p key={project.id} title={project.name} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12 }}>
                        {project.name}
                      </p>
                    ))}
                    {assigned.length > 2 ? <small>+{assigned.length - 2} projets</small> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <p className="muted">Cette première vue conserve les dates existantes des projets. Elle ne remplace pas le futur agenda personnel et partagé.</p>
    </>
  );
}
