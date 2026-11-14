import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { orbitDateLabel } from "@/lib/orbit/calendar";

export default async function OrbitPlannerPage() {
  const ctx = await requireOrganization();
  const permitted = await hasPermission(ctx, "sales.view");
  if (!permitted) return (
    <div className="card section" role="alert">
      Vous n'avez pas l'autorisation de consulter les échéances des projets de cette entreprise.
    </div>
  );
  const today = new Date().toISOString().slice(0, 10);
  const { data: projects, error } = await ctx.supabase
    .from("projects")
    .select("id,name,reference,status,start_date,end_date")
    .eq("organization_id", ctx.organizationId)
    .gte("end_date", today)
    .neq("status", "cancelled")
    .order("end_date", { ascending: true })
    .limit(100);
  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Magnisa Orbit · Planification</p>
          <h1>Magnisa Planner</h1>
          <p>Échéances à venir des projets MAGNISA, sans duplication des dossiers existants.</p>
        </div>
        <Link className="button" href="/projets">Gérer les projets</Link>
      </div>
      {error ? (
        <div className="card section" role="alert">Impossible de charger les échéances. Réessayez depuis Projets &amp; missions.</div>
      ) : (
        <div className="card section">
          <h2>Échéances des projets</h2>
          {projects?.length ? (
            <div className="tableWrap"><table><thead>
              <tr><th>Date limite</th><th>Projet</th><th>Statut</th></tr>
            </thead><tbody>
              {projects.map(project => (
                <tr key={project.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{orbitDateLabel(project.end_date)}</td>
                  <td><strong>{project.name}</strong>{project.reference ? <p className="muted">{project.reference}</p> : null}</td>
                  <td>{project.status}</td>
                </tr>
              ))}
            </tbody></table></div>
          ) : <p className="muted">Aucune échéance de projet à venir.</p>}
        </div>
      )}
      <div className="card section">
        <h2>Agenda des rendez-vous</h2>
        <p>Le calendrier individuel, les réunions de service et les rappels automatisés sont en cours
          de migration. Ils ne sont pas présentés comme actifs avant la validation du schéma dédié.</p>
      </div>
    </>
  );
}
