import Link from "next/link";
import { requireUser } from "@/lib/current-org";

export default async function PersonalSpace() {
  const { supabase, user } = await requireUser();
  const [{data:profile,error:profileError},{data:memberships,error:membershipsError}] = await Promise.all([
    supabase.from("profiles").select("full_name,username,public_id,email").eq("id",user.id).maybeSingle(),
    supabase.from("organization_members").select("organization_id,role,status").eq("user_id",user.id).eq("status","active"),
  ]);
  if(profileError||membershipsError)throw new Error("Espace personnel indisponible.");
  const ids=(memberships||[]).map(m=>m.organization_id);
  const {data:companies,error} = ids.length ? await supabase.from("organizations")
    .select("id,name").in("id",ids):{data:[],error:null};
  if(error)throw new Error("Impossible de charger les entreprises.");
  const names=new Map((companies||[]).map(c=>[c.id,c.name]));
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
      <p>Les invitations arrivent sur l'adresse e-mail personnelle avec un lien sécurisé. N'utilise que les invitations que tu reconnais.</p>
      <p className="muted">La boîte d'invitations intégrée et le refus/acceptation explicite feront partie du lot « Invitations et accès ».</p>
    </div>
    <div className="card section"><h2>Préférences et sécurité</h2>
      <p>La gestion détaillée du profil et des sessions sera complétée dans les paramètres personnels.</p>
    </div>
  </main>;
}
