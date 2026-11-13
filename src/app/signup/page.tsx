"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/server/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import { REGISTRATION_LOCALITIES, REGISTRATION_COUNTRY_CODE, REGISTRATION_COUNTRY_NAME, generateUsername, normalizeUsername } from "@/lib/auth/magnisa-identity";

export default function Signup() {
  const router = useRouter();
  const [state, action, pending] = useActionState<any, FormData>(async (_: any, data: FormData) => signUp(data), {});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [customized, setCustomized] = useState(false);
  useEffect(() => {
    if (state?.email) router.push(`/verify-email?email=${encodeURIComponent(state.email)}`);
  }, [state, router]);
  useEffect(() => {
    if (!customized) setUsername(generateUsername(firstName, lastName));
  }, [firstName, lastName, customized]);

  return (
    <main className="auth authPremium">
      <BrandMark />
      <div>
        <p className="eyebrow">Créer votre espace personnel</p>
        <h1>Bienvenue sur MAGNISA</h1>
        <p className="muted">Un compte personnel unique, même si tu rejoins plusieurs entreprises. Ton identifiant public permanent à 14 chiffres ne dévoile pas ton lieu d'inscription.</p>
      </div>
      <form action={action} className="form">
        <div className="field">
          <label htmlFor="signup-first-name">Prénom</label>
          <input id="signup-first-name" name="first_name" required maxLength={60} autoComplete="given-name"
            placeholder="Francky" value={firstName} onChange={e => setFirstName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="signup-last-name">Nom</label>
          <input id="signup-last-name" name="last_name" required maxLength={60} autoComplete="family-name"
            placeholder="Masinjaka" value={lastName} onChange={e => setLastName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="signup-username">Nom d'utilisateur MAGNISA</label>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span aria-hidden="true" style={{ fontWeight:700 }}>@</span>
            <input id="signup-username" name="username" required minLength={3} maxLength={10}
              pattern="[a-z]{3,10}" autoCapitalize="none" autoComplete="username" spellCheck={false}
              placeholder="nomutilisateur" aria-describedby="username-help" value={username}
              onChange={e => {
                const clean = normalizeUsername(e.target.value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z]/g,"").slice(0,10);
                setCustomized(true);
                setUsername(clean);
              }}
              style={{ width:"100%" }} />
          </div>
          <small id="username-help">Généré à partir du prénom et du nom, personnalisable : 3 à 10 lettres. `@` est ajouté automatiquement.</small>
          {customized && <button type="button" className="button" onClick={() => { setCustomized(false); setUsername(generateUsername(firstName,lastName)); }}>Reprendre le nom suggéré</button>}
        </div>
        <div className="field">
          <label htmlFor="signup-email">Adresse e-mail personnelle</label>
          <input id="signup-email" name="email" type="email" required autoComplete="email" placeholder="prenom@exemple.com" />
          <small>Gmail, Outlook, Yahoo, adresse professionnelle et autres fournisseurs sont acceptés.</small>
        </div>
        <div className="field">
          <label htmlFor="signup-password">Mot de passe</label>
          <input id="signup-password" name="password" type="password" minLength={10} required autoComplete="new-password" />
          <small>10 caractères minimum.</small>
        </div>
        <div className="field">
          <label htmlFor="signup-password-confirm">Confirmer le mot de passe</label>
          <input id="signup-password-confirm" name="confirm_password" type="password" minLength={10} required autoComplete="new-password" />
        </div>
        <div className="field">
          <label htmlFor="signup-country">Pays au moment de l'inscription</label>
          <input id="signup-country" value={REGISTRATION_COUNTRY_NAME} readOnly />
          <input type="hidden" name="country_code" value={REGISTRATION_COUNTRY_CODE} />
        </div>
        <div className="field">
          <label htmlFor="signup-locality">Localité d'inscription</label>
          <select id="signup-locality" name="locality_code" required defaultValue="">
            <option value="" disabled>Choisir une localité</option>
            {REGISTRATION_LOCALITIES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
          <small>Lieu d'origine conservé confidentiellement. Le choix des régions et petites localités sera étendu.</small>
        </div>
        {state?.error && <p role="alert" className="error">{state.error}</p>}
        <button className="button primary" disabled={pending}>{pending ? "Création…" : "Créer mon compte personnel"}</button>
      </form>
      <p className="muted"><Link href="/login">J'ai déjà un compte</Link></p>
    </main>
  );
}
