import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/current-org";

async function respondToInvitation(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organization_id") || "").trim();
  const accept = String(formData.get("accept") || "") === "true";
  if (!organizationId) throw new Error("Invitation invalide.");

  const { supabase } = await requireUser();
  const { error } = await (supabase as any).rpc("respond_to_organization_invitation", {
    p_organization_id: organizationId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message || "Impossible de répondre à l'invitation.");

  revalidatePath("/espace-personnel");
  if (accept) redirect("/choisir-organisation");
}

export default async function PersonalSpace() {
  const { supabase, user } = await requireUser();
  const [{data:profile,error:profileError},{data:memberships,error:membershipsError},{data:invitations,error:invitationsError}] = await Promise.all([
    supabase.from("profiles").select("full_name,username,public_id,email").eq("id",user.id).maybeSingle(),
    supabase.from("organization_members").select("organization_id,role,status").eq("user_id",user.id).eq("status","active"),
    (supabase as any).rpc("get_my_organization_invitations"),
  ]);
  if(profileError||membershipsError||invitationsError)throw new Error("Espace personnel indisponible.");
  const pendingInvitations = invitations ?? [];
  const ids=(memberships||[]).map(m=>m.organization_id);
  const organizationsResult = ids.length ? await supabase.from("organizations")
    .select("id,name").in("id",ids):null;
  if(organizationsResult?.error)throw new Error("Impossible de charger les entreprises.");
  const companies: Array<{id:string;name:string}> = organizationsResult?.data ?? [];
  const names=new Map(companies.map(company=>[company.id,company.name]));
  return <main className="auth authPremium" style={{maxWidth:850,margin:"0 auto"}}>
    <p className="eyebrow">MAGNISA — Compte personnel</p>
    <h1>Mon espace personnel</h1>
    <div className="card section"><h2>Mon identité</h2>
      <p><strong>{profile?.full_name||"Profil à compléter"}</strong></p>
      <p>@{profile?.username||"à définir"} · {profile?.email||user.email||""}</p>
      <p className="muted">ID MAGNISA : {profile?.public_id||"Attribution en cours"}</p>
      <p className="muted">Ce compte est indépendant des informations de chaque entreprise.</p>
    </div>
    <div className="card section"><h2>Mes entreprises</h2>
      {!memberships?.length ? <p>Aucune entreprise liée à ton compte pour le moment.</p>:
        <ul>{memberships.map(m=><li key={m.organization_id}>{names.get(m.organization_id)||"Entreprise"} — {m.role}</li>)}</ul>}
      <Link href="/creer-entreprise" className="button">Créer une entreprise</Link>
      {!!memberships?.length && <Link href="/choisir-organisation" className="button">Changer d'entreprise</Link>}
    </div>
    <div className="card section" id="invitations"><h2>Mes invitations</h2>
      {!pendingInvitations.length ? <p>Aucune invitation en attente.</p> :
        <ul>
          {pendingInvitations.map((invitation: {organization_id:string;organization_name:string;role:string;invited_at:string}) => (
            <li key={invitation.organization_id} style={{marginBottom:16}}>
              <p><strong>{invitation.organization_name}</strong></p>
              <p>Rôle proposé : {invitation.role}</p>
              <p className="muted">Invitation reçue le {new Date(invitation.invited_at).toLocaleDateString("fr-FR")}</p>
              <div className="actions">
                <form action={respondToInvitation}>
                  <input type="hidden" name="organization_id" value={invitation.organization_id} />
                  <input type="hidden" name="accept" value="true" />
                  <button className="button primary" type="submit">Accepter</button>
                </form>
                <form action={respondToInvitation}>
                  <input type="hidden" name="organization_id" value={invitation.organization_id} />
                  <input type="hidden" name="accept" value="false" />
                  <button className="button" type="submit">Refuser</button>
                </form>
              </div>
            </li>
          ))}
        </ul>}
    </div>
    <div className="card section"><h2>Préférences et sécurité</h2>
      <p>La gestion détaillée du profil et des sessions sera complétée dans les paramètres personnels.</p>
    </div>
  </main>;
}
