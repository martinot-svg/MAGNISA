import Link from "next/link";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { FormDialog } from "@/components/form-dialog";
import { diagnoseOrbitDomainDNS, orbitDnsHost, orbitDnsValue, validateOrbitDkimSelector } from "@/lib/orbit/domain-dns";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN_PATH = "/orbit/magnibox/domaines";

async function verifyDomainOwnership(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "users.manage");
  const id = String(form.get("id") || "");
  if (!UUID.test(id)) throw Error("Domaine demandé invalide.");

  const { data: domain, error } = await ctx.supabase.from("mgmail_domain_requests")
    .select("id,domain_name,status,verification_token,platform_allocation_id")
    .eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
  if (error || !domain || !["pending", "reviewing", "verified"].includes(domain.status)) {
    throw Error("Ce domaine ne peut pas être vérifié pour votre entreprise.");
  }

  const admin = createAdminClient();
  let proofReference: string;
  if (domain.platform_allocation_id) {
    // A MAGNISA-managed subdomain is NOT customer-owned DNS. Never ask its tenant
    // to publish a TXT token. Require the exact, operator-provisioned allocation.
    const { data: allocation, error: allocationError } = await admin
      .from("magnibox_platform_domain_allocations")
      .select("id,organization_id,assigned_domain,status,dns_verified_at,provisioning_reference,catalog_domain_id,root_domain")
      .eq("id", domain.platform_allocation_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (allocationError || !allocation ||
        allocation.assigned_domain !== domain.domain_name ||
        allocation.status !== "active" ||
        !allocation.dns_verified_at ||
        !allocation.provisioning_reference?.trim()) {
      throw Error("Le sous-domaine MAGNISA n'est pas encore provisionné et vérifié par l'opérateur.");
    }

    const { data: root, error: rootError } = await admin
      .from("magnibox_platform_domain_catalog")
      .select("id,root_domain,ownership_status,ownership_verified_at,ownership_evidence_ref,mail_status,mx_verified,spf_verified,dkim_verified,dmarc_verified,is_active")
      .eq("id", allocation.catalog_domain_id)
      .maybeSingle();
    if (rootError || !root ||
        root.root_domain !== allocation.root_domain ||
        root.ownership_status !== "verified" ||
        !root.ownership_verified_at ||
        !root.ownership_evidence_ref?.trim() ||
        root.mail_status !== "ready" ||
        !root.mx_verified || !root.spf_verified || !root.dkim_verified || !root.dmarc_verified ||
        !root.is_active) {
      throw Error("Le domaine racine MAGNISA n'a pas toutes ses preuves de propriété et de routage.");
    }
    proofReference = "magnisa-platform-allocation-sha256:" + createHash("sha256")
      .update([allocation.id, allocation.assigned_domain, allocation.dns_verified_at,
        allocation.provisioning_reference, root.ownership_evidence_ref].join("|"))
      .digest("hex");
  } else {
    // Custom domains still require the customer's exact unpredictable DNS TXT proof.
    const dns = await diagnoseOrbitDomainDNS(domain.domain_name, domain.verification_token);
    if (dns.ownership === "unavailable") {
      throw Error("Le serveur DNS est momentanément inaccessible. Réessayez ultérieurement.");
    }
    if (dns.ownership !== "confirmed") {
      throw Error("La preuve TXT de propriété est absente ou incorrecte. Vérifiez les DNS.");
    }
    proofReference = "dns-txt-sha256:" + createHash("sha256")
      .update(`${domain.domain_name}|${orbitDnsValue(domain.verification_token)}`)
      .digest("hex");
  }

  if (domain.status !== "verified") {
    const result = await admin.from("mgmail_domain_requests")
      .update({
        status: "verified",
        verified_at: new Date().toISOString(),
        proof_reference: proofReference,
      })
      .eq("id", domain.id).eq("organization_id", ctx.organizationId)
      .in("status", ["pending", "reviewing"])
      .select("id").maybeSingle();
    if (result.error || !result.data) {
      throw Error("Vérification non enregistrée : domaine déjà revendiqué ou état incompatible.");
    }
  }
  revalidatePath(`${DOMAIN_PATH}/${id}`);
  revalidatePath(DOMAIN_PATH);
}

const diagnostics: Record<string, string> = {
  confirmed: "Preuve de propriété TXT trouvée",
  present: "Enregistrement DNS trouvé (fonctionnement à confirmer)",
  absent: "Enregistrement absent ou incorrect",
  invalid: "Plusieurs SPF concurrents : correction requise",
  unavailable: "Vérification momentanément indisponible",
  not_checked: "Sélecteur DKIM du fournisseur non renseigné",
};

export default async function OrbitDomainDNSPage({
  params, searchParams,
}: {
  params: Promise<{ domainId: string }>;
  searchParams: Promise<{ selector?: string }>;
}) {
  const ctx = await requireOrganization();
  if (!await hasPermission(ctx, "users.manage")) {
    return <div className="card section" role="alert">
      Cette page est réservée aux administrateurs autorisés de l'entreprise.
    </div>;
  }
  const { domainId } = await params;
  if (!UUID.test(domainId)) {
    return <div className="card section" role="alert">Identifiant de domaine invalide.</div>;
  }
  const { data: domain, error } = await ctx.supabase.from("mgmail_domain_requests")
    .select("id,domain_name,verification_token,status,verified_at,platform_allocation_id")
    .eq("id", domainId).eq("organization_id", ctx.organizationId).maybeSingle();
  if (error || !domain) {
    return <div className="card section" role="alert">Ce domaine n'est pas accessible à votre entreprise.</div>;
  }

  if (domain.platform_allocation_id) {
    const admin = createAdminClient();
    const { data: allocation, error: allocationError } = await admin
      .from("magnibox_platform_domain_allocations")
      .select("id,organization_id,assigned_domain,status,dns_verified_at,provisioning_reference,catalog_domain_id,root_domain")
      .eq("id", domain.platform_allocation_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const { data: root, error: rootError } = allocation
      ? await admin.from("magnibox_platform_domain_catalog")
          .select("root_domain,ownership_status,ownership_verified_at,ownership_evidence_ref,mail_status,mx_verified,spf_verified,dkim_verified,dmarc_verified,is_active")
          .eq("id", allocation.catalog_domain_id).maybeSingle()
      : { data: null, error: null };
    const allocationReady = !allocationError && !rootError && !!allocation &&
      allocation.assigned_domain === domain.domain_name &&
      allocation.status === "active" && !!allocation.dns_verified_at &&
      !!allocation.provisioning_reference?.trim() && !!root &&
      root.root_domain === allocation.root_domain &&
      root.ownership_status === "verified" && !!root.ownership_verified_at &&
      !!root.ownership_evidence_ref?.trim() && root.mail_status === "ready" &&
      root.mx_verified && root.spf_verified && root.dkim_verified && root.dmarc_verified &&
      root.is_active;
    return (
      <>
        <header className="pageHead">
          <div>
            <p className="eyebrow">Magnisa Orbit · Magnibox</p>
            <h1>Domaine MAGNISA : {domain.domain_name}</h1>
            <p>Sous-domaine géré par MAGNISA : aucune modification DNS n'est demandée à votre entreprise.</p>
          </div>
          <Link href={DOMAIN_PATH} className="button">Retour aux domaines</Link>
        </header>
        <div className="card section">
          <h2>Vérification du provisionnement MAGNISA</h2>
          <p>La validation repose sur les preuves internes du catalogue de domaines et du provisionnement opérateur, pas sur un TXT que votre entreprise ne peut pas publier.</p>
          <p><strong>Allocation :</strong> {allocation?.status || "introuvable"}</p>
          <p><strong>Routage DNS enregistré :</strong> {allocation?.dns_verified_at ? "oui" : "non"}</p>
          <p><strong>Référence de provisionnement :</strong> {allocation?.provisioning_reference ? "présente" : "absente"}</p>
          <p><strong>Racine MAGNISA :</strong> {root?.ownership_status || "indisponible"} / {root?.mail_status || "indisponible"}</p>
          <p><strong>Contrôles MX, SPF, DKIM et DMARC :</strong> {root && root.mx_verified && root.spf_verified && root.dkim_verified && root.dmarc_verified ? "tous validés" : "preuves incomplètes"}</p>
          <p><strong>État :</strong> {domain.status === "verified" ? "Domaine validé" : allocationReady ? "Prêt pour validation" : "En attente du provisionnement et des preuves opérateur"}</p>
          {!allocationReady && <p className="muted">La validation reste bloquée tant que l'allocation n'est pas active, que le domaine exact ne correspond pas ou qu'une preuve de routage manque.</p>}
          {allocationReady && domain.status !== "verified" && (
            <FormDialog title="Valider le domaine MAGNISA" buttonLabel="Valider le domaine">
              <form action={verifyDomainOwnership} className="form">
                <input type="hidden" name="id" value={domain.id} />
                <p>Les preuves internes sont complètes. Cette validation ne prétend pas démontrer une livraison SMTP Internet réelle.</p>
                <button type="submit" className="button primary">Confirmer la validation</button>
              </form>
            </FormDialog>
          )}
          {domain.status === "verified" && <p>Les preuves de domaine sont enregistrées. L'envoi et la réception Internet restent soumis aux tests du transport réel.</p>}
        </div>
      </>
    );
  }

  const query = await searchParams;
  let selector: string | undefined;
  try {
    if (query.selector) selector = validateOrbitDkimSelector(query.selector);
  } catch {
    selector = undefined;
  }
  const diagnostic = await diagnoseOrbitDomainDNS(domain.domain_name, domain.verification_token, selector);
  return (
    <>
      <header className="pageHead">
        <div>
          <p className="eyebrow">Magnisa Orbit · Magnibox</p>
          <h1>Vérifier {domain.domain_name}</h1>
          <p>Vérification DNS du domaine public, sans modification automatique de vos DNS.</p>
        </div>
        <Link href={DOMAIN_PATH} className="button">Retour aux domaines</Link>
      </header>
      <div className="card section">
        <h2>1. Prouver que votre entreprise contrôle le domaine</h2>
        <p>Dans la zone DNS de {domain.domain_name}, créez un enregistrement TXT avec les valeurs suivantes :</p>
        <div className="tableWrap"><table>
          <thead><tr><th>Type</th><th>Nom / hôte</th><th>Valeur exacte</th></tr></thead>
          <tbody><tr>
            <td>TXT</td><td><code>{orbitDnsHost(domain.domain_name)}</code></td>
            <td style={{ overflowWrap: "anywhere" }}><code>{orbitDnsValue(domain.verification_token)}</code></td>
          </tr></tbody>
        </table></div>
        <p className="muted">Le fournisseur DNS peut demander uniquement le préfixe
          <code> _magnisa-verify </code> plutôt que le nom complet. Ne partagez ce jeton qu'avec
          les responsables DNS autorisés.</p>
        <p><strong>État :</strong> {domain.status === "verified"
          ? "Propriété vérifiée — aucune boîte Internet activée"
          : "Demande en attente de preuve DNS"}</p>
        <p><strong>Lecture actuelle :</strong> {diagnostics[diagnostic.ownership]}</p>
        {diagnostic.ownership === "confirmed" && domain.status !== "verified" && (
          <FormDialog title="Confirmer la propriété DNS" buttonLabel="Valider le domaine">
            <form action={verifyDomainOwnership} className="form">
              <input type="hidden" name="id" value={domain.id} />
              <p>La preuve TXT a été trouvée. Cela confirme uniquement la propriété du domaine,
                pas l'activation d'une boîte de courrier Internet.</p>
              <button type="submit" className="button primary">Confirmer la propriété du domaine</button>
            </form>
          </FormDialog>
        )}
        {domain.status === "verified" && <p>La propriété DNS est enregistrée.
          L'envoi et la réception resteront inactifs jusqu'au raccordement d'un véritable transport.</p>}
      </div>
      <div className="card section">
        <h2>2. Examiner la configuration du courrier Internet</h2>
        <div className="tableWrap"><table><thead><tr><th>Vérification</th><th>Diagnostic</th></tr></thead>
          <tbody>
            <tr><td>MX — réception</td><td>{diagnostics[diagnostic.mx]}</td></tr>
            <tr><td>SPF — sources d'envoi</td><td>{diagnostics[diagnostic.spf]}</td></tr>
            <tr><td>DMARC — politique du domaine</td><td>{diagnostics[diagnostic.dmarc]}</td></tr>
            <tr><td>DKIM — signature du fournisseur</td><td>{diagnostics[diagnostic.dkim]}</td></tr>
          </tbody></table></div>
        <form method="get" className="form">
          <div className="field">
            <label htmlFor="orbit-dkim-selector">Sélecteur DKIM indiqué par votre fournisseur e-mail</label>
            <input id="orbit-dkim-selector" name="selector" placeholder="ex. mail"
              defaultValue={selector} pattern="[A-Za-z0-9_-]{1,63}" maxLength={63} />
          </div>
          <button className="button" type="submit">Contrôler le sélecteur DKIM</button>
        </form>
        <p className="muted">Ces diagnostics confirment seulement la présence de certains
          enregistrements. Ils ne valident ni les signatures, ni la délivrabilité, ni le fonctionnement
          réel du transport : un test d'envoi et de réception reste indispensable.</p>
      </div>
    </>
  );
}
