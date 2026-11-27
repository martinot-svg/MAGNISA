"use client";
import { useActionState } from "react";
import { verifyMajorityForExistingAccount } from "@/server/actions/auth";
import { BrandMark } from "@/components/brand-mark";

export function VerifyMajorityForm() {
  const [state, action, pending] = useActionState(verifyMajorityForExistingAccount, {});
  return <main className="auth authPremium">
    <BrandMark/>
    <p className="eyebrow">Sécurité du compte</p>
    <h1>Confirmer votre majorité</h1>
    <p className="muted">Pour utiliser MAGNISA, vous devez avoir au moins 18 ans. Votre date de naissance est conservée dans un espace privé et n'est pas ajoutée à votre profil public.</p>
    <form action={action} className="form">
      <div className="field">
        <label htmlFor="majority-birth-date">Date de naissance</label>
        <input id="majority-birth-date" name="birth_date" type="date" required max={new Date().toISOString().slice(0,10)} autoComplete="bday"/>
      </div>
      <label><input name="majority_confirmed" type="checkbox" value="true" required/> Je confirme que les informations fournies sont exactes et que j'ai au moins 18 ans.</label>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      <button className="button primary" type="submit" disabled={pending}>{pending?"Vérification…":"Confirmer et continuer"}</button>
    </form>
  </main>;
}
