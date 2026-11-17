import Link from "next/link";
import {revalidatePath} from "next/cache";
import {requireOrganization} from "@/lib/current-org";
import {assertPermission,hasPermission} from "@/lib/permissions";
import {normalizeMagniboxTenantLabel,suggestMagniboxTenantLabel} from "@/lib/orbit/platform-domains";

const PATH="/orbit/magnibox/domaines-gratuits";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function reserveFreeDomain(form:FormData){
  "use server";
  const ctx=await requireOrganization();
  await assertPermission(ctx,"users.manage");
  const catalogDomainId=String(form.get("catalogDomainId")||"").trim();
  if(!UUID.test(catalogDomainId))throw new Error("Choix de domaine invalide.");
  const tenantLabel=normalizeMagniboxTenantLabel(String(form.get("tenantLabel")||""));
  const {error}=await ctx.supabase.rpc("magnibox_reserve_free_domain",{
    p_organization_id:ctx.organizationId,
    p_catalog_domain_id:catalogDomainId,
    p_tenant_label:tenantLabel,
  });
  if(error)throw new Error(error.message.includes("déjà")||error.message.includes("disponible")
    ?error.message:"Impossible de réserver ce domaine gratuit.");
  revalidatePath(PATH);
  revalidatePath("/orbit/magnibox");
}

export default async function MagniboxFreeDomainsPage(){
  const ctx=await requireOrganization();
  const canManage=await hasPermission(ctx,"users.manage");
  const [{data:catalog,error:catalogError},{data:allocations,error:allocationError},{data:organization}] = await Promise.all([
    ctx.supabase.from("magnibox_platform_domain_catalog")
      .select("id,root_domain,display_name,category")
      .order("display_name",{ascending:true}),
    ctx.supabase.from("magnibox_platform_domain_allocations")
      .select("id,root_domain,tenant_label,assigned_domain,status,created_at")
      .eq("organization_id",ctx.organizationId).neq("status","released")
      .order("created_at",{ascending:false}).limit(1),
    ctx.supabase.from("organizations").select("name").eq("id",ctx.organizationId).single(),
  ]);
  const options=catalog||[];
  const allocation=allocations?.[0]||null;
  const suggested=suggestMagniboxTenantLabel(organization?.name||"");
  const loadFailed=!!catalogError||!!allocationError;
  return <>
    <div className="pageHead">
      <div>
        <p className="eyebrow">MAGNISA ORBIT · MAGNIBOX</p>
        <h1>Domaines professionnels gratuits</h1>
        <p>Choisissez un domaine administré par MAGNISA pour l’identité numérique de votre entreprise.</p>
      </div>
      <Link className="button" href="/orbit/magnibox">Retour à MAGNIBOX</Link>
    </div>

    <div className="card section">
      <h2>Votre domaine MAGNIBOX</h2>
      <p>La mise à disposition du domaine est gratuite. MAGNISA ne propose ici que les domaines complets
        dont la propriété et la configuration de messagerie ont été validées par la plateforme.
        Le catalogue IANA des extensions (.mg, .com, .digital, etc.) reste distinct de ce catalogue.</p>
      {loadFailed?<p role="alert">Le catalogue des domaines gratuits est momentanément indisponible. Aucune disponibilité n'est supposée.</p>
      :allocation?<>
        <p><strong>{allocation.assigned_domain}</strong></p>
        <p className="muted">{allocation.status==="reserved"
          ?"Domaine réservé gratuitement. Le provisionnement DNS et MTA propre à cette entreprise reste à effectuer."
          :allocation.status==="provisioning"?"Provisionnement technique en cours."
          :allocation.status==="active"?"Domaine activé par le service de provisionnement MAGNIBOX."
          :allocation.status==="suspended"?"Domaine suspendu par la plateforme."
          :"Domaine réservé."}</p>
        <p className="muted">La réservation du domaine ne crée pas encore une boîte mail opérationnelle.</p>
      </>:!canManage?<p className="muted">La réservation est réservée à un administrateur autorisé de l'entreprise.</p>
      :options.length===0?<p className="muted">Aucun domaine n'est actuellement publiable. Le catalogue sera alimenté après validation de domaines contrôlés par MAGNISA et de leurs enregistrements MX, SPF, DKIM et DMARC.</p>
      :<form action={reserveFreeDomain} className="form">
        <div className="field">
          <label htmlFor="magnibox-free-domain">Domaine proposé par MAGNISA</label>
          <select id="magnibox-free-domain" name="catalogDomainId" required defaultValue="">
            <option value="" disabled>Choisir un domaine gratuit</option>
            {options.map(domain=><option key={domain.id} value={domain.id}>
              {domain.display_name} · {domain.root_domain}
            </option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="magnibox-tenant-label">Identifiant public de l'entreprise</label>
          <input id="magnibox-tenant-label" name="tenantLabel" defaultValue={suggested}
            minLength={2} maxLength={45} pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
          <p className="muted">L'identifiant est associé au domaine choisi pour former votre sous-domaine professionnel.</p>
        </div>
        <p className="muted">Exemple de format : identifiant.domaine-MAGNISA. Le nom exact est construit à partir de l'option sélectionnée.</p>
        <button className="button primary" type="submit">Réserver gratuitement ce domaine</button>
      </form>}
    </div>

    <div className="card section">
      <h2>Ce que comprend la gratuité</h2>
      <ul>
        <li>Choix parmi les domaines publiés et disponibles dans le catalogue MAGNISA.</li>
        <li>Réservation d'un sous-domaine unique pour l'entreprise.</li>
        <li>Aucun achat de domaine demandé à l'entreprise.</li>
        <li>Création de l'adresse et de la boîte mail dans une étape de provisionnement distincte.</li>
      </ul>
    </div>
  </>;
}
