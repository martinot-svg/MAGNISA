"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "@/server/actions/auth";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<any, FormData>(
    async (_previous: any, formData: FormData) => requestPasswordReset(formData),
    {},
  );

  return (
    <form action={action} className="form">
      <div className="field">
        <label htmlFor="forgot-password-email">Adresse e-mail</label>
        <input id="forgot-password-email" name="email" type="email" autoComplete="email" required />
      </div>
      {state?.error && <p className="error">{state.error}</p>}
      {state?.success && <p className="success">{state.success}</p>}
      <button className="button primary" disabled={pending}>
        {pending ? "Envoi…" : "Envoyer le lien"}
      </button>
    </form>
  );
}
