"use client";
import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/server/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import { REGISTRATION_LOCALITIES, REGISTRATION_COUNTRY_CODE, REGISTRATION_COUNTRY_NAME } from "@/lib/auth/magnisa-identity";

export default function Signup() {
  const router = useRouter();
  const [state, action, pending] = useActionState<any, FormData>(async (_:any, data:FormData) => signUp(data), {});
  useEffect(() => {
    if (state?.email) router.push(`/verify-email?email=${encodeURIComponent(state.email)}`);
  }, [state, router]);
  return (
    <main className="auth authPremium">
      <BrandMark />
      <div><p className="eyebrow">Créer votre espace</p><h1>Commencer avec MAGNISA</h1>
        <p className="muted">Ton identité est unique sur MAGNISA. Ton numéro public à 14 chiffres sera attribué automatiquement ; les codes géographiques restent confidentiels.</p>
      </div>
      <form action={action} className="form">
        <div className="field"><label htmlFor="signup-full-name">Nom complet</label>
          <input id="signup-full-name" name="full_name" required minLength={2} maxLength={120} autoComplete="name" placeholder="Prénom et nom" />
        </div>
        <div className="field"><label htmlFor="signup-username">Nom d'utilisateur</label>
          <input id="signup-username" name="username" required minLength={3} maxLength={30}
            pattern="[A-Za-z][A-Za-z0-9._]{2,29}" autoCapitalize="none" autoComplete="username"
            placeholder="exemple.utilisateur" aria-describedby="username-help" />
          <small id="username-help">3 à 30 caractères : lettres, chiffres, points et tiret bas. Utilisable pour te connecter.</small>
        </div>
        <div className="field"><label htmlFor="signup-email">Adresse e-mail</label>
          <input id="signup-email" name="email" type="email" required autoComplete="email" placeholder="direction@entreprise.mg"/>
        </div>
        <div className="field"><label htmlFor="signup-password">Mot de passe</label>
          <input id="signup-password" name="password" type="password" minLength={10} required autoComplete="new-password"/>
          <small>10 caractères minimum.</small>
        </div>
        <div className="field"><label htmlFor="signup-country">Pays au moment de l'inscription</label>
          <input id="signup-country" value={REGISTRATION_COUNTRY_NAME} readOnly aria-describedby="signup-geo-help"/>
          <input type="hidden" name="country_code" value={REGISTRATION_COUNTRY_CODE}/>
        </div>
        <div className="field"><label htmlFor="signup-locality">Localité au moment de l'inscription</label>
          <select id="signup-locality" name="locality_code" required defaultValue="">
            <option value="" disabled>Choisir une localité</option>
            {REGISTRATION_LOCALITIES.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
          <small id="signup-geo-help">Ce lieu sert uniquement à l'identification interne et ne pourra plus être modifié dans ton numéro d'origine.</small>
        </div>
        {state?.error && <p role="alert" className="error">{state.error}</p>}
        <button className="button primary" disabled={pending}>{pending?"Création…":"Créer mon compte"}</button>
      </form>
      <p className="muted"><Link href="/login">J'ai déjà un compte</Link></p>
    </main>
  );
}
