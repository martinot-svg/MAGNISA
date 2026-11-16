"use client";

import { useActionState } from "react";
import { updatePassword } from "@/server/actions/auth";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<any, FormData>(
    async (_previous: any, formData: FormData) => updatePassword(formData),
    {},
  );

  return (
    <form action={action} className="form">
      <div className="field">
        <label htmlFor="new-password">Nouveau mot de passe</label>
        <input id="new-password" name="password" type="password" minLength={10} autoComplete="new-password" required />
      </div>
      <div className="field">
        <label htmlFor="confirm-password">Confirmer</label>
        <input id="confirm-password" name="confirm" type="password" minLength={10} autoComplete="new-password" required />
      </div>
      {state?.error && <p className="error">{state.error}</p>}
      {state?.success && <p className="success">{state.success}</p>}
      <button className="button primary" disabled={pending}>
        {pending ? "Modification…" : "Modifier le mot de passe"}
      </button>
    </form>
  );
}
