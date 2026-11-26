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
    <h1>Comment souhaitez-vous utiliser MAGNISA ?</h1>
    <p className="muted">Votre compte personnel est créé. Choisissez l'espace qui correspond à votre besoin.</p>
    <div className="grid2">
      <section className="card">
        <h2>Créer un espace pour mon organisation</h2>
        <p>Créez un espace professionnel pour gérer les activités, les informations administratives, les équipes et les opérations de votre organisation.</p>
        <Link className="button primary" href="/creer-entreprise">Créer un espace</Link>
      </section>
      <section className="card">
        <h2>Rejoindre une équipe</h2>
        <p>Accédez à une organisation en acceptant une invitation envoyée par son administrateur.</p>
        <Link className="button" href="/espace-personnel#invitations">Voir mes invitations</Link>
      </section>
      <section className="card" aria-describedby="personal-finance-status">
        <h2>Gérer mes finances personnelles</h2>
        <p>Un espace personnel pour suivre et organiser vos finances au quotidien.</p>
        <p id="personal-finance-status" className="muted">Bientôt disponible</p>
        <button className="button" type="button" disabled>Indisponible pour le moment</button>
      </section>
    </div>
    <p className="muted"><Link href="/espace-personnel">Accéder à mon espace personnel</Link></p>
  </main>;
}
