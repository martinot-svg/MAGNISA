"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useEffect, useState } from "react";
import { resendEmailCode, verifyEmailCode } from "@/server/actions/auth";
import { BrandMark } from "@/components/brand-mark";

function VerifyEmailContent() {
  const sp = useSearchParams();
  const email = sp.get("email") || "";
  const [state, action, pending] = useActionState<any,FormData>(async (_: any, fd: FormData) => verifyEmailCode(fd), {});
  const [resendState, resendAction, resendPending] = useActionState<any,FormData>(async (_: any, fd: FormData) => resendEmailCode(fd), {});
  const [seconds, setSeconds] = useState(60);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);

  useEffect(() => {
    if (resendState?.success) setSeconds(60);
  }, [resendState]);

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
                autoFocus
                minLength={6}
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
            <button className="button subtle" disabled={resendPending || seconds > 0}>{resendPending ? "Envoi…" : seconds > 0 ? `Renvoyer dans ${seconds}s` : "Renvoyer le code"}</button>
            {resendState?.error && <p className="error compact">{resendState.error}</p>}
            {resendState?.success && <p className="success compact">{resendState.success}</p>}
          </form>
        </>
      )}
      <p className="muted"><Link href="/login">Retour à la connexion</Link></p>
    </main>
  );
}

export default function VerifyEmail(){
  return <Suspense fallback={<main className="auth authPremium"><BrandMark/><p className="muted">Chargement de la vérification…</p></main>}><VerifyEmailContent/></Suspense>;
}
