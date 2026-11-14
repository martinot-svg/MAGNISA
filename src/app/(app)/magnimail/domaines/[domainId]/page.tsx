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

async function verifyDomainOwnership(form: FormData) {
  "use server";
  // Obtain and check authenticated tenant access BEFORE creating a service-role client.
  const ctx = await requireOrganization();
  await assertPermission(ctx,"users.manage");
  const id = String(form.get("id") || "");
  if (!UUID.test(id)) throw Error("Domaine demandé invalide.");
  const { data: domain, error } = await ctx.supabase.from("mgmail_domain_requests")
    .select("id,domain_name,status,verification_token")
    .eq("id",id).eq("organization_id",ctx.organizationId).maybeSingle();
  if (error || !domain || !["pending","reviewing","verified"].includes(domain.status)) {
    throw Error("Ce domaine ne peut pas être vérifié pour votre entreprise.");
  }
  // DNS TXT is looked up by the SERVER against the actual public resolver.
  // Only an EXACT unpredictable token proves ownership.
  const dns = await diagnoseOrbitDomainDNS(domain.domain_name,domain.verification_token);
  if (dns.ownership === "unavailable") {
    throw Error("Le serveur DNS est momentanément inaccessible. Réessayez ultérieurement.");
  }
  if (dns.ownership !== "confirmed") {
    throw Error("La preuve TXT de propriété est absente ou incorrecte. Vérifiez les DNS.");
  }
  if (domain.status !== "verified") {
    const proof = createHash("sha256")
      .update(`${domain.domain_name}|${orbitDnsValue(domain.verification_token)}`)
      .digest("hex");
    const admin = createAdminClient();
    const result = await admin.from("mgmail_domain_requests")
      .update({
        status:"verified",
        verified_at:new Date().toISOString(),
        proof_reference:`dns-txt-sha256:${proof}`,
      })
      .eq("id",domain.id).eq("organization_id",ctx.organizationId)
      .in("status",["pending","reviewing"])
      .select("id").maybeSingle();
    if (result.error || !result.data) {
      throw Error("Vérification non enregistrée : domaine déjà revendiqué ou état incompatible.");
    }
  }
  // Ownership verification does NOT provision a domain/mailbox or enable sending.
  revalidatePath(`/orbit/magnibox/domaines/${id}`);
  revalidatePath("/orbit/magnibox/domaines");
}

const diagnostics: Record<string,string> = {
  confirmed:"Preuve de propriété TXT trouvée",
  present:"Enregistrement DNS trouvé (fonctionnement à confirmer)",
  absent:"Enregistrement absent ou incorrect",
  invalid:"Plusieurs SPF concurrents : correction requise",
  unavailable:"Vérification momentanément indisponible",
  not_checked:"Sélecteur DKIM du fournisseur non renseigné",
};

export default async function OrbitDomainDNSPage({
  params,searchParams,
}: {
  params:Promise<{domainId:string}>;
  searchParams:Promise<{selector?:string}>;
}) {
  const ctx=await requireOrganization();
  if (!await hasPermission(ctx,"users.manage")) {
    return <div className="card section" role="alert">
      Cette page est réservée aux administrateurs autorisés de l'entreprise.
    </div>;
  }
  const {domainId}=await params;
  if (!UUID.test(domainId)) {
    return <div className="card section" role="alert">Identifiant de domaine invalide.</div>;
  }
  const {data:domain,error}=await ctx.supabase.from("mgmail_domain_requests")
    .select("id,domain_name,verification_token,status,verified_at")
    .eq("id",domainId).eq("organization_id",ctx.organizationId).maybeSingle();
  if (error || !domain) {
    return <div className="card section" role="alert">Ce domaine n'est pas accessible à votre entreprise.</div>;
  }
  const query=await searchParams;
  let selector: string | undefined;
  try {
    if (query.selector) selector=validateOrbitDkimSelector(query.selector);
  } catch {
    selector=undefined;
  }
  const diagnostic=await diagnoseOrbitDomainDNS(domain.domain_name,domain.verification_token,selector);
  return (
    <>
      <header className="pageHead">
        <div>
          <p className="eyebrow">Magnisa Orbit · Magnibox</p>
          <h1>Vérifier {domain.domain_name}</h1>
          <p>Vérification DNS du domaine public, sans modification automatique de vos DNS.</p>
        </div>
        <Link href="/orbit/magnibox/domaines" className="button">Retour aux domaines</Link>
      </header>
      <div className="card section">
        <h2>1. Prouver que votre entreprise contrôle le domaine</h2>
        <p>Dans la zone DNS de {domain.domain_name}, créez un enregistrement TXT avec les valeurs suivantes :</p>
        <div className="tableWrap"><table>
          <thead><tr><th>Type</th><th>Nom / hôte</th><th>Valeur exacte</th></tr></thead>
          <tbody><tr>
            <td>TXT</td>
            <td><code>{orbitDnsHost(domain.domain_name)}</code></td>
            <td style={{overflowWrap:"anywhere"}}><code>{orbitDnsValue(domain.verification_token)}</code></td>
          </tr></tbody>
        </table></div>
        <p className="muted">Le fournisseur DNS peut demander uniquement le préfixe
          <code> _magnisa-verify </code> plutôt que le nom complet. Ne partagez ce jeton qu'avec
          les responsables DNS autorisés.</p>
        <p><strong>État :</strong> {domain.status==="verified"
          ? "Propriété vérifiée — aucune boîte Internet activée"
          : "Demande en attente de preuve DNS"}</p>
        <p><strong>Lecture actuelle :</strong> {diagnostics[diagnostic.ownership]}</p>
        {diagnostic.ownership==="confirmed" && domain.status!=="verified" && (
          <FormDialog title="Confirmer la propriété DNS" buttonLabel="Valider le domaine">
            <form action={verifyDomainOwnership} className="form">
              <input type="hidden" name="id" value={domain.id}/>
              <p>La preuve TXT a été trouvée. Cela confirme uniquement la propriété du domaine,
                pas l'activation d'une boîte de courrier Internet.</p>
              <button type="submit" className="button primary">Confirmer la propriété du domaine</button>
            </form>
          </FormDialog>
        )}
        {domain.status==="verified" && <p>La propriété DNS est enregistrée.
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
              defaultValue={selector} pattern="[A-Za-z0-9_-]{1,63}" maxLength={63}/>
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
