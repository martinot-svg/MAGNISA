import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/current-org";

export default async function Onboarding() {
  const { supabase, user } = await requireUser();
  const { data: memberships, error } = await supabase.from("organization_members")
    .select("organization_id").eq("user_id",user.id).eq("status","active").limit(1);
  if(error)throw new Error("Impossible de vérifier vos entreprises.");
  if(memberships?.length)redirect("/choisir-organisation");
  return <main className="auth authPremium" style={{maxWidth:840,margin:"0 auto"}}>
    <p className="eyebrow">Bienvenue sur MAGNISA</p>
    <h1>Que souhaitez-vous faire ?</h1>
    <p className="muted">Ton compte personnel est créé. Tu peux commencer sans entreprise et changer de choix plus tard.</p>
    <div className="grid2">
      <section className="card">
        <h2>Créer une entreprise</h2>
        <p>Ouvrir un espace de gestion avec les informations juridiques, les activités, le logo, la fiscalité et l'exercice comptable.</p>
        <Link className="button primary" href="/creer-entreprise">Créer mon entreprise</Link>
      </section>
      <section className="card">
        <h2>Rejoindre une entreprise</h2>
        <p>Accepter un lien d'invitation sécurisé envoyé par un administrateur à ton e-mail personnel.</p>
        <Link className="button" href="/espace-personnel#invitations">Mes invitations</Link>
      </section>
      <section className="card">
        <h2>Mon espace personnel</h2>
        <p>Consulter ton profil, tes entreprises, tes invitations et les paramètres de sécurité.</p>
        <Link className="button" href="/espace-personnel">Accéder à mon espace personnel</Link>
      </section>
    </div>
  </main>;
}
