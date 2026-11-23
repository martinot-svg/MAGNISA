import { FormDialog } from "@/components/form-dialog";
import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

const DEFAULT_OFFSETS = [3, 1, 0, -1, -7];

async function saveInvoiceReminderRule(fd: FormData) {
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
    rule_key: "invoice_due",
    category: "finance",
    enabled,
    reminder_offsets_days: offsets,
    channels: { in_app: true, email: false, push: false },
    updated_by: ctx.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,rule_key" });
  if (error) throw new Error(error.message);
  revalidatePath("/notifications");
  revalidatePath("/notifications/parametres");
}

export default async function InvoiceReminderSettingsPage() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "settings.manage");
  const { data: rule, error } = await ctx.supabase
    .from("notification_rules")
    .select("enabled,reminder_offsets_days")
    .eq("organization_id", ctx.organizationId)
    .eq("rule_key", "invoice_due")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const enabled = rule?.enabled ?? true;
  const offsets: number[] = rule?.reminder_offsets_days ?? DEFAULT_OFFSETS;
  const displayOffsets = offsets.length ? offsets.join(", ") : "Aucun rappel programmé";
  return <><div className="pageHead"><div><p className="eyebrow">Paramètres · Notifications</p><h1>Rappels de factures</h1><p>Configure les alertes internes de l’équipe avant et après l’échéance des factures clients.</p></div><a className="button secondary" href="/notifications">Retour aux notifications</a></div><section className="section"><div className="card"><h2>Règle de rappel des factures</h2><p>Configuration actuelle : <strong>{enabled ? "Activée" : "Désactivée"}</strong></p><p>Décalages en jours : <strong>{displayOffsets}</strong></p><p className="muted">Un nombre positif déclenche un rappel avant l’échéance, zéro le jour même et un nombre négatif après l’échéance. Les alertes sont publiées uniquement dans le centre de notifications interne. Aucun e-mail ni push client n’est envoyé.</p><FormDialog title="Configurer les rappels de factures" buttonLabel="Modifier la règle"><form action={saveInvoiceReminderRule} className="form"><label className="checkRow"><input type="checkbox" name="enabled" defaultChecked={enabled}/> Activer les rappels automatiques</label><div className="field"><label>Décalages en jours (séparés par des virgules)</label><input name="reminder_offsets_days" defaultValue={offsets.join(", ")} placeholder="3, 1, 0, -1, -7"/><p className="muted">Valeurs entières de -30 à +30. Exemple : 3, 1, 0, -1, -7.</p></div><button className="button primary" type="submit">Enregistrer les rappels</button></form></FormDialog></div></section></>;
}
