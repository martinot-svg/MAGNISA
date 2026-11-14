import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { orbitDateLabel } from "@/lib/orbit/calendar";

const stages = [
  { key: "planned", label: "Planifié" },
  { key: "active", label: "En cours" },
  { key: "on_hold", label: "En attente" },
  { key: "completed", label: "Terminé" },
  { key: "cancelled", label: "Annulé" },
] as const;

export default async function OrbitActionPage() {
  const ctx = await requireOrganization();
  const permitted = await hasPermission(ctx, "sales.view");
  if (!permitted) return (
    <div className="card section" role="alert">
      Vous n'avez pas l'autorisation de consulter les projets de cette entreprise.
    </div>
  );
  const { data: projects, error } = await ctx.supabase.from("projects")
    .select("id,name,reference,status,start_date,end_date")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false }).limit(150);
  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Magnisa Orbit · Projets et responsabilités</p>
          <h1>Magnisa Action</h1>
          <p>Vue par statut des projets existants, sans modification de la comptabilité ou des dossiers commerciaux.</p>
        </div>
        <Link className="button primary" href="/projets">Créer ou gérer un projet</Link>
      </div>
      {error ? <div className="card section" role="alert">Impossible de lire les projets autorisés.</div> : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(185px,1fr))", gap: 12, minWidth: 990 }}>
            {stages.map(stage => {
              const items = (projects || []).filter(project => project.status === stage.key);
              return <section key={stage.key} className="card section" aria-label={stage.label}>
                <h2>{stage.label} ({items.length})</h2>
                {items.length ? items.map(project => (
                  <article key={project.id} className="card" style={{ marginBottom: 10 }}>
                    <strong>{project.name}</strong>
                    {project.reference && <p className="muted">{project.reference}</p>}
                    {project.end_date && <small>Échéance : {orbitDateLabel(project.end_date)}</small>}
                  </article>
                )) : <p className="muted">Aucun projet</p>}
              </section>;
            })}
          </div>
        </div>
      )}
      <div className="card section">
        <h2>Tâches collaboratives</h2>
        <p>Le modèle dédié aux tâches, sous-tâches, responsables, commentaires, pièces jointes et historique
          n'est pas encore activé. Cette vue montre exclusivement les projets existants de MAGNISA.</p>
      </div>
    </>
  );
}
