import { hasPermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { MagniboxInternalContent } from "@/components/magnibox-internal-workspace";
import { MagniboxInternetWorkspace } from "@/components/magnibox-internet-workspace";

export default async function MagniboxPage({ searchParams }: { searchParams?: Promise<{ q?: string | string[]; folder?: string | string[] }> }) {
  const params = searchParams ? await searchParams : {};
  const searchQuery = Array.isArray(params.q) ? (params.q[0] || "") : (params.q || "");
  const selectedFolderId = Array.isArray(params.folder) ? (params.folder[0] || "") : (params.folder || "");
  const ctx = await requireOrganization();
  const canManageDomains = await hasPermission(ctx, "users.manage");

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Magnisa Orbit · Communication</p>
          <h1>Magnibox</h1>
          <p>Une messagerie unique pour les collaborateurs et les adresses professionnelles de l'entreprise.</p>
        </div>
      </div>

      <MagniboxInternalContent embedded searchQuery={searchQuery} selectedFolderId={selectedFolderId} />
      <MagniboxInternetWorkspace />

      {canManageDomains && (
        <div className="card section">
          <h2>Configuration et activation de MAGNIBOX</h2>
          <p className="muted">
            Contrôlez les paramètres serveur, suivez les prérequis SMTP et DNS et préparez
            l'activation sécurisée de la messagerie Internet.
          </p>
          <a className="button primary" href="/orbit/magnibox/configuration">Ouvrir le centre de configuration</a>
        </div>
      )}

      <div className="card section">
        <h2>Agenda et rendez-vous</h2>
        <p className="muted">Calendriers personnels, de service et d'entreprise avec fuseaux horaires et rappels internes.</p>
        <a className="button" href="/orbit/magnibox/agenda">Ouvrir l'agenda</a>
      </div>

      {canManageDomains && (
        <>
          <div className="card section">
            <h2>Obtenir un domaine professionnel gratuit</h2>
            <p className="muted">
              Choisissez un domaine complet administré par MAGNISA. La réservation est gratuite
              et indépendante de l'achat d'un domaine par votre entreprise.
            </p>
            <a className="button primary" href="/orbit/magnibox/domaines-gratuits">Choisir un domaine gratuit</a>
          </div>
          <div className="card section">
            <h2>Domaines et adresses professionnelles</h2>
            <p className="muted">
              Gérez les domaines, les preuves DNS et les adresses de votre entreprise.
              L'activation Internet intervient uniquement après validation du transport MAGNIBOX.
            </p>
            <a className="button" href="/orbit/magnibox/domaines">Administrer les domaines</a>
          </div>
          <div className="card section">
            <h2>Catalogue des extensions</h2>
            <p className="muted">
              Consultez les extensions officielles IANA et les règles nationales NIC.MG.
              Le catalogue indique les règles d'éligibilité, pas la disponibilité d'un domaine.
            </p>
            <a href="/orbit/magnibox/extensions" className="button">Consulter le catalogue</a>
          </div>
        </>
      )}
    </>
  );
}
