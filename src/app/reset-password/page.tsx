import { BrandMark } from "@/components/brand-mark";
import { ResetPasswordForm } from "@/components/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="auth authPremium">
      <BrandMark />
      <div>
        <p className="eyebrow">Sécurité</p>
        <h1>Nouveau mot de passe</h1>
        <p className="muted">Choisis un mot de passe d'au moins 10 caractères.</p>
      </div>
      <ResetPasswordForm />
    </main>
  );
}
