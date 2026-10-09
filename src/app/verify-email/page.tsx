"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { resendEmailCode, verifyEmailCode } from "@/server/actions/auth";
import { BrandMark } from "@/components/brand-mark";

export default function VerifyEmail() {
  const sp = useSearchParams();
  const email = sp.get("email") || "";
  const [state, action, pending] = useActionState(async (_: any, fd: FormData) => verifyEmailCode(fd), {});
  const [resendState, resendAction, resendPending] = useActionState(async (_: any, fd: FormData) => resendEmailCode(fd), {});

  return (
    <main className="auth authPremium">
      <BrandMark />
      <div>
        <p className="eyebrow">Sécurité du compte</p>
        <h1>Vérifie ton adresse e-mail</h1>
        <p className="muted">Nous avons envoyé un code à 6 chiffres à <b>{email || "ton adresse"}</b>.</p>
      </div>

      {!email ? (
        <p className="error">Adresse de vérification manquante. Reprends l'inscription.</p>
      ) : (
        <>
          <form action={action} className="form">
            <input type="hidden" name="email" value={email} />
            <div className="field">
              <label>Code de vérification</label>
              <input
                className="codeInput"
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                required
                placeholder="000000"
                aria-label="Code de vérification à 6 chiffres"
              />
            </div>
            {state?.error && <p className="error">{state.error}</p>}
            <button className="button primary" disabled={pending}>{pending ? "Vérification…" : "Vérifier mon e-mail"}</button>
          </form>

          <form action={resendAction}>
            <input type="hidden" name="email" value={email} />
            <button className="button subtle" disabled={resendPending}>{resendPending ? "Envoi…" : "Renvoyer le code"}</button>
            {resendState?.error && <p className="error compact">{resendState.error}</p>}
            {resendState?.success && <p className="success compact">{resendState.success}</p>}
          </form>
        </>
      )}
      <p className="muted"><Link href="/login">Retour à la connexion</Link></p>
    </main>
  );
}
