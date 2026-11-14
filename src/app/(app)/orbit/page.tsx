import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";

export default async function OrbitHome() {
  const ctx = await requireOrganization();
  const canProjects = await hasPermission(ctx, "sales.view");
  const modules = [
    {
      href: "/orbit/magnibox", title: "Magnibox",
      subtitle: "Messagerie professionnelle",
      detail: "Boîtes internes et courrier externe connecté, sans obligation de Gmail.",
      action: "Ouvrir la messagerie",
    },
    {
      href: "/orbit/planner", title: "Magnisa Planner",
      subtitle: "Agenda et planification",
      detail: "Échéances des projets existants. Les rendez-vous personnels et rappels ont leur propre chantier de migration.",
      action: "Consulter les échéances",
    },
    {
      href: "/orbit/time", title: "Magnisa Time",
      subtitle: "Calendrier et gestion du temps",
      detail: "Vue mensuelle des dates de projets. Le calendrier collaboratif sera activé après la validation de ses migrations.",
      action: "Voir le calendrier",
    },
    {
      href: "/orbit/action", title: "Magnisa Action",
      subtitle: "Projets et productivité",
      detail: "Suivi des projets commerciaux existants. Les tâches Kanban, sous-tâches et commentaires sont une extension distincte.",
      action: "Voir les projets",
    },
  ] as const;
  return (
    <>
      <header className="pageHead">
        <div>
          <p className="eyebrow">Magnisa Box · Communication et organisation</p>
          <h1>Magnisa Orbit</h1>
          <p>Communication &amp; Productivity</p>
        </div>
      </header>
      <div className="grid2">
        {modules.map((module, index) => (
          <section key={module.href} className="card section">
            <p className="eyebrow">0{index + 1} · {module.subtitle}</p>
            <h2>{module.title}</h2>
            <p>{module.detail}</p>
            {index === 0 || canProjects ? (
              <Link className="button primary" href={module.href}>{module.action}</Link>
            ) : (
              <p className="muted">L'accès aux échéances et projets nécessite une autorisation commerciale.</p>
            )}
          </section>
        ))}
      </div>
      <div className="card section">
        <h2>Continuité de service</h2>
        <p>Magnibox conserve les boîtes et les messages existants. Les adresses internes
          restent privées à MAGNISA. Un domaine Internet personnalisé ne sera déclaré utilisable
          qu'après vérification de sa propriété, de son transport et de la réception réelle.</p>
        <Link className="button" href="/orbit/magnibox">Ouvrir Magnibox</Link>
      </div>
    </>
  );
}
