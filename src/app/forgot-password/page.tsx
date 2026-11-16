import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="auth authPremium">
      <BrandMark />
      <div>
        <p className="eyebrow">Récupération</p>
        <h1>Mot de passe oublié</h1>
        <p className="muted">Nous enverrons un lien sécurisé à l'adresse du compte.</p>
      </div>
      <ForgotPasswordForm />
      <Link className="muted" href="/login">Retour à la connexion</Link>
    </main>
  );
}
