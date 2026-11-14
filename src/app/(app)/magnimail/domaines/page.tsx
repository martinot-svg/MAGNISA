import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, hasPermission } from "@/lib/permissions";
import { FormDialog } from "@/components/form-dialog";
import { normalizeOrbitDomain, normalizeOrbitLocalPart } from "@/lib/orbit/domains";

const PATH = "/magnimail/domaines";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const labels: Record<string,string> = {
  pending: "Demande reçue", reviewing: "Vérification en cours",
  verified: "Domaine vérifié (transport à confirmer)",
  approved: "Demande d'adresse approuvée (non activée)",
  rejected: "Demande rejetée",
};

async function requestDomain(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "users.manage");
  const domainName = normalizeOrbitDomain(String(form.get("domainName") || ""));
  const { error } = await ctx.supabase.from("mgmail_domain_requests").insert({
    organization_id: ctx.organizationId,
    domain_name: domainName,
    requested_by: ctx.user.id,
  });
  if (error) {
    throw new Error(error.code === "23505"
      ? "Ce domaine fait déjà l'objet d'une demande de votre entreprise."
      : "Impossible d'enregistrer cette demande de domaine.");
  }
  revalidatePath(PATH);
}

async function requestAddress(form: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "users.manage");
  const domainRequestId = String(form.get("domainRequestId") || "");
  const mailboxId = String(form.get("mailboxId") || "");
  if (!UUID.test(domainRequestId) || !UUID.test(mailboxId)) {
    throw new Error("Domaine ou boîte professionnelle invalide.");
  }
  const localPart = normalizeOrbitLocalPart(String(form.get("localPart") || ""));
  const [domainResult, mailboxResult] = await Promise.all([
    ctx.supabase.from("mgmail_domain_requests").select("id,domain_name,status")
      .eq("id", domainRequestId).eq("organization_id", ctx.organizationId).maybeSingle(),
    ctx.supabase.from("mgmail_internal_mailboxes").select("id")
      .eq("id", mailboxId).eq("organization_id", ctx.organizationId)
      .eq("is_active", true).maybeSingle(),
  ]);
  if (domainResult.error || !domainResult.data ||
      !["pending","reviewing","verified"].includes(domainResult.data.status) ||
      mailboxResult.error || !mailboxResult.data) {
    throw new Error("Le domaine et la boîte doivent appartenir à cette entreprise et être disponibles.");
  }
  const { error } = await ctx.supabase.from("mgmail_public_address_requests").insert({
    organization_id: ctx.organizationId,
    requested_by: ctx.user.id,
    domain_request_id: domainResult.data.id,
    domain_name: domainResult.data.domain_name,
    mailbox_id: mailboxResult.data.id,
    local_part: localPart,
  });
  if (error) throw new Error(error.code === "23505"
    ? "Cette adresse fait déjà l'objet d'une demande."
    : "Impossible de demander cette adresse professionnelle.");
  revalidatePath(PATH);
}

export default async function MagnisaInboxProfessionalDomains() {
  const ctx = await requireOrganization();
  const canManage = await hasPermission(ctx,"users.manage");
  if (!canManage) return (
    <div className="card section" role="alert">
      La gestion des domaines et des adresses est réservée aux administrateurs autorisés de l'entreprise.
    </div>
  );
  const [domainsResult, addressesResult, mailboxesResult] = await Promise.all([
    ctx.supabase.from("mgmail_domain_requests")
      .select("id,domain_name,status,created_at").eq("organization_id",ctx.organizationId)
      .order("created_at",{ascending:false}).limit(100),
    ctx.supabase.from("mgmail_public_address_requests")
      .select("id,email_address,status,mailbox_id,created_at")
      .eq("organization_id",ctx.organizationId).order("created_at",{ascending:false}).limit(100),
    ctx.supabase.from("mgmail_internal_mailboxes")
      .select("id,local_part,display_name,is_active").eq("organization_id",ctx.organizationId)
      .eq("is_active",true).order("local_part"),
  ]);
  const domains = domainsResult.data || [];
  const addresses = addressesResult.data || [];
  const mailboxes = mailboxesResult.data || [];
  const canRequestAddress = domains.some(d => d.status !== "rejected") && mailboxes.length > 0;
  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Magnisa Orbit · Magnisa Inbox</p>
          <h1>Domaines et adresses professionnelles</h1>
          <p>Déclarer les domaines autorisés de l'entreprise et demander les adresses à attribuer aux boîtes.</p>
        </div>
        <Link className="button" href="/orbit/inbox">Retour à Magnisa Inbox</Link>
      </div>
      <div className="card section">
        <strong>La demande ne crée pas encore une adresse Internet opérationnelle.</strong>
        <p>Un domaine comme entreprise.mg, entreprise.com ou entreprise.org doit être contrôlé
          légitimement par votre entreprise, puis vérifié techniquement (DNS, MX, SPF, DKIM et DMARC).
          L'envoi, la réception, les alias et les boîtes externes nécessitent un transport réellement
          configuré et testé. Les messages internes existants restent accessibles dans MGMail.</p>
      </div>
      {domainsResult.error || addressesResult.error || mailboxesResult.error ? (
        <div role="alert" className="card section">
          Le registre des domaines et adresses n'est pas disponible. La migration du lot de demandes
          doit être vérifiée avant son utilisation.
        </div>
      ) : (
        <>
          <div className="card section">
            <h2>Demandes de domaines</h2>
            <FormDialog title="Déclarer un domaine public" buttonLabel="+ Demander un domaine">
              <form action={requestDomain} className="form">
                <div className="field">
                  <label htmlFor="orbit-domain-name">Domaine professionnel</label>
                  <input id="orbit-domain-name" name="domainName" placeholder="entreprise.mg"
                    maxLength={253} required />
                </div>
                <p className="muted">Aucun achat ni changement de DNS n'est réalisé automatiquement.</p>
                <button className="button primary" type="submit">Enregistrer la demande</button>
              </form>
            </FormDialog>
            {domains.length ? <div className="tableWrap"><table>
              <thead><tr><th>Domaine</th><th>Vérification</th><th>DNS</th></tr></thead>
              <tbody>{domains.map(domain => <tr key={domain.id}>
                <td>{domain.domain_name}</td><td>{labels[domain.status] || domain.status}</td>
                <td><Link href={`/magnimail/domaines/${domain.id}`} className="button">
                  Vérifier le domaine et les DNS
                </Link></td>
              </tr>)}</tbody>
            </table></div> : <p className="muted">Aucun domaine déclaré pour cette entreprise.</p>}
          </div>
          <div className="card section">
            <h2>Demandes d'adresses professionnelles</h2>
            <p>Chaque demande est rattachée à une boîte MGMail existante pour conserver ses
              collaborateurs et autorisations. La boîte Internet ou l'alias réel n'est pas encore activé.</p>
            {canRequestAddress ? (
              <FormDialog title="Demander une adresse professionnelle" buttonLabel="+ Demander une adresse">
                <form action={requestAddress} className="form">
                  <div className="field"><label>Domaine</label>
                    <select name="domainRequestId" required>
                      <option value="">Choisir un domaine</option>
                      {domains.filter(d => d.status !== "rejected").map(d =>
                        <option key={d.id} value={d.id}>{d.domain_name}</option>)}
                    </select></div>
                  <div className="field"><label>Boîte de service ou collaborateur</label>
                    <select name="mailboxId" required>
                      <option value="">Choisir une boîte</option>
                      {mailboxes.map(m => <option key={m.id} value={m.id}>{m.display_name || m.local_part}</option>)}
                    </select></div>
                  <div className="field"><label>Nom de l'adresse</label>
                    <input name="localPart" placeholder="finance" minLength={1} maxLength={64} required />
                  </div>
                  <p className="muted">Exemple : finance@entreprise.mg si le domaine sélectionné est entreprise.mg.</p>
                  <button className="button primary" type="submit">Enregistrer la demande</button>
                </form>
              </FormDialog>
            ) : <p className="muted">Déclarez d'abord un domaine et créez une boîte interne pour pouvoir demander une adresse.</p>}
            {addresses.length ? <div className="tableWrap"><table>
              <thead><tr><th>Adresse souhaitée</th><th>État</th></tr></thead>
              <tbody>{addresses.map(address => <tr key={address.id}>
                <td>{address.email_address}</td><td>{labels[address.status] || address.status}</td>
              </tr>)}</tbody></table></div> : <p className="muted">Aucune adresse publique demandée.</p>}
          </div>
        </>
      )}
    </>
  );
}
