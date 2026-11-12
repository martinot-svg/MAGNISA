export type FormDialogServerAction = (formData: FormData) => void | Promise<void>;
type PendingRef = { current: boolean };
type Callbacks = {
  setPending: (pending: boolean) => void;
  setError: (error: string | null) => void;
  onSuccess: () => void;
};

export function formatFormDialogError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/NEXT_REDIRECT/i.test(message)) throw error;
  if (/permission denied|row.level security|not authorized|unauthorized/i.test(message)) {
    return "Tu n'as pas les autorisations nécessaires pour effectuer cette opération.";
  }
  if (/duplicate key|unique constraint/i.test(message)) {
    return "Un enregistrement avec ces informations existe déjà.";
  }
  if (/failed to fetch|networkerror|fetch failed/i.test(message)) {
    return "Le serveur n'a pas répondu. Vérifie la connexion puis réessaie.";
  }
  return message && message.length <= 240
    ? message
    : "L'opération n'a pas abouti. Vérifie les informations puis réessaie.";
}

/** Shared submission lifecycle for direct and nested FormDialog server actions. */
export async function executeFormDialogAction(
  action: FormDialogServerAction,
  formData: FormData,
  pendingRef: PendingRef,
  callbacks: Callbacks,
  propagateErrors = false,
): Promise<void> {
  if (pendingRef.current) return;
  pendingRef.current = true;
  callbacks.setPending(true);
  callbacks.setError(null);
  try {
    const result: unknown = await action(formData);
    if (result && typeof result === "object" && "error" in result && result.error) {
      throw new Error(String(result.error));
    }
    callbacks.onSuccess();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/NEXT_REDIRECT/i.test(message)) throw error;
    if (propagateErrors) throw error;
    callbacks.setError(formatFormDialogError(error));
  } finally {
    pendingRef.current = false;
    callbacks.setPending(false);
  }
}
