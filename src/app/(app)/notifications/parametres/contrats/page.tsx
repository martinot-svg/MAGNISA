import { FormDialog } from "@/components/form-dialog";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

const DEFAULT_OFFSETS = [30, 7, 0];

async function saveContractExpiryRule(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "settings.manage");
  const rawOffsets = String(fd.get("reminder_offsets_days") || "");
  const offsets = [...new Set(rawOffsets.split(",").map((value) => value.trim()).filter(Boolean).map(Number))];
  if (offsets.some((value) => !Number.isInteger(value) || value < -30 || value > 30)) {
    throw new Error("Chaque décalage doit être un nombre entier compris entre -30 et 30.");
  }
  offsets.sort((a, b) => b - a);
  const enabled = fd.get("enabled") === "on";
  const { error } = await ctx.supabase.from("notification_rules").upsert({
    organization_id: ctx.organizationId,
    rule_key: "recurring_contract_end",
    category: "service",
    enabled,
    reminder_offsets_days: offsets,
    channels: { in_app: true, email: false, push: false },
    updated_by: ctx.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,rule_key" });
  if (error) throw new Error(error.message);
  revalidatePath("/notifications");
  revalidatePath("/notifications/parametres");
  revalidatePath("/notifications/parametres/contrats");
}

export default async function RecurringContractExpirySettingsPage() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "settings.manage");
  const { data: rule, error } = await ctx.supabase
    .from("notification_rules")
    .select("enabled,reminder_offsets_days")
    .eq("organization_id", ctx.organizationId)
    .eq("rule_key", "recurring_contract_end")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const enabled = rule?.enabled ?? true;
  const offsets: number[] = rule?.reminder_offsets_days ?? DEFAULT_OFFSETS;
  const displayOffsets = offsets.length ? offsets.join(", ") : "Aucun rappel programmé";
  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Paramètres · Notifications</p>
          <h1>Fin des contrats récurrents</h1>
          <p>Configure les alertes internes pour anticiper le renouvellement ou la clôture des prestations récurrentes.</p>
        </div>
        <a className="button secondary" href="/notifications/parametres">Retour aux paramètres</a>
      </div>
      <section className="section">
        <div className="card">
          <h2>Règle de fin de contrat</h2>
          <p>Configuration actuelle : <strong>{enabled ? "Activée" : "Désactivée"}</strong></p>
          <p>Décalages en jours : <strong>{displayOffsets}</strong></p>
          <p className="muted">Un nombre positif déclenche un rappel avant la date de fin, zéro le jour même et un nombre négatif après la date de fin. Les notifications sont internes et respectent les préférences service des membres. Le statut du contrat n’est pas modifié automatiquement.</p>
          <FormDialog title="Configurer les rappels de fin de contrat" buttonLabel="Modifier la règle">
            <form action={saveContractExpiryRule} className="form">
              <label className="checkRow"><input type="checkbox" name="enabled" defaultChecked={enabled}/> Activer les rappels automatiques</label>
              <div className="field">
                <label>Décalages en jours (séparés par des virgules)</label>
                <input name="reminder_offsets_days" defaultValue={offsets.join(", ")} placeholder="30, 7, 0"/>
                <p className="muted">Valeurs entières de -30 à +30. Exemple : 30, 7, 0.</p>
              </div>
              <button className="button primary" type="submit">Enregistrer les rappels</button>
            </form>
          </FormDialog>
        </div>
      </section>
    </>
  );
}
