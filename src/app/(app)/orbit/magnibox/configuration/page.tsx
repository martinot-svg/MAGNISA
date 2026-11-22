import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { magniboxSmtpConfig } from "@/lib/orbit/transport/smtp";

export const dynamic = "force-dynamic";

export default async function MagniboxConfigurationPage() {
  const ctx = await requireOrganization();
  const canManage = await hasPermission(ctx, "users.manage");
  if (!canManage) {
    return (
      <div className="card section" role="alert">
        La configuration de MAGNIBOX est réservée aux administrateurs autorisés de l'entreprise.
      </div>
    );
  }

  // Expose readiness booleans only. Never return SMTP credentials or secret values.
  const smtpConfigured = magniboxSmtpConfig() !== null;
  const inboundSecretConfigured = Boolean(process.env.MAGNIBOX_INBOUND_WEBHOOK_SECRET?.trim());
  const externalMailEnabled = process.env.MAGNIBOX_EXTERNAL_MAIL_ENABLED === "true";

  const checks = [
    { label: "Paramètres SMTP serveur valides", ready: smtpConfigured,
      detail: "Hôte, port, identifiant, mot de passe et nom HELO sont présents et valides." },
    { label: "Secret du pont entrant configuré", ready: inboundSecretConfigured,
      detail: "Le secret HMAC est présent côté serveur pour authentifier le MTA entrant." },
    { label: "Activation du courrier Internet", ready: externalMailEnabled,
      detail: "Le coupe-circuit serveur autorise les opérations Internet. Ne l'activer qu'après recette complète." },
  ];
  const appReady = smtpConfigured && inboundSecretConfigured && externalMailEnabled;

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Magnisa Orbit · Magnibox</p>
          <h1>Configuration de MAGNIBOX</h1>
          <p>Centre de préparation et de contrôle du service de messagerie de votre entreprise.</p>
        </div>
        <div className="actions">
          <Link className="button" href="/orbit/magnibox">Retour à Magnibox</Link>
        </div>
      </div>

      <section className="card section">
        <h2>État de la configuration applicative</h2>
        <p role="status" className="muted">
          {appReady
            ? "Les paramètres applicatifs requis sont présents. Cela ne prouve pas encore la disponibilité du serveur ni la livraison des e-mails."
            : "La configuration applicative n'est pas complète. Les fonctions de courrier Internet doivent rester désactivées jusqu'à validation."}
        </p>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Contrôle</th><th>État</th><th>Détail</th></tr></thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.label}>
                  <td>{check.label}</td>
                  <td><span className="badge">{check.ready ? "Configuré" : "Manquant / désactivé"}</span></td>
                  <td>{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card section">
        <h2>Où saisir les paramètres serveur</h2>
        <p>Les identifiants SMTP et les secrets ne doivent jamais être saisis dans le navigateur, enregistrés dans Supabase côté client ou préfixés par NEXT_PUBLIC_. Ils doivent être ajoutés comme variables d'environnement serveur dans les paramètres du projet Vercel, puis le déploiement doit être relancé.</p>
        <ul>
          <li><code>MAGNIBOX_EXTERNAL_MAIL_ENABLED</code> — laisser à <code>false</code> pendant la préparation.</li>
          <li><code>MAGNIBOX_SMTP_HOST</code></li>
          <li><code>MAGNIBOX_SMTP_PORT</code> — généralement <code>587</code> avec STARTTLS.</li>
          <li><code>MAGNIBOX_SMTP_SECURE</code> — <code>false</code> pour STARTTLS sur 587.</li>
          <li><code>MAGNIBOX_SMTP_USER</code> et <code>MAGNIBOX_SMTP_PASSWORD</code></li>
          <li><code>MAGNIBOX_SMTP_HELO</code></li>
          <li><code>MAGNIBOX_INBOUND_WEBHOOK_SECRET</code></li>
        </ul>
        <p className="muted">Cette page vérifie uniquement la présence et la cohérence des paramètres applicatifs. Elle n'affiche aucune valeur secrète et ne teste pas la connectivité SMTP.</p>
      </section>

      <section className="card section">
        <h2>Étapes obligatoires avant activation</h2>
        <ol>
          <li>Déclarer un domaine réellement contrôlé par l'entreprise et valider sa preuve DNS.</li>
          <li>Préparer l'hôte de messagerie dédié, son IP publique stable, son reverse DNS/PTR et l'accès réseau SMTP.</li>
          <li>Configurer et vérifier MX, SPF, DKIM et DMARC sans remplacer les enregistrements existants sans autorisation.</li>
          <li>Activer le filtrage antispam, l'antivirus, les limites d'envoi, les sauvegardes et la supervision.</li>
          <li>Effectuer un aller-retour contrôlé avec des adresses externes indépendantes et vérifier livraison, rebond et réception.</li>
          <li>Seulement après validation, faire activer le service par un opérateur autorisé.</li>
        </ol>
        <p className="muted">Le serveur de messagerie MAGNIBOX est une infrastructure distincte de Vercel. Une configuration applicative valide ne crée pas un serveur SMTP, ne modifie pas le DNS et ne garantit pas la délivrabilité.</p>
        <div className="actions">
          <Link className="button" href="/orbit/magnibox/domaines">Gérer les domaines</Link>
          <Link className="button" href="/orbit/magnibox/domaines-gratuits">Voir les domaines disponibles</Link>
        </div>
      </section>
    </>
  );
}
