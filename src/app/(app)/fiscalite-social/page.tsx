import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";

async function createTax(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");

  const row = {
    organization_id: ctx.organizationId,
    obligation_type: String(fd.get("obligation_type") || "").trim(),
    period_start: String(fd.get("period_start") || ""),
    period_end: String(fd.get("period_end") || ""),
    due_date: String(fd.get("due_date") || ""),
    amount: Number(fd.get("amount") || 0),
  };

  if (!row.obligation_type || !Number.isFinite(row.amount) || row.amount < 0) {
    throw new Error("Obligation invalide.");
  }
  if (!row.period_start || !row.period_end || !row.due_date || row.period_end < row.period_start) {
    throw new Error("Période ou échéance invalide.");
  }

  const { error } = await ctx.supabase.from("tax_obligations").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath("/fiscalite-social");
  revalidatePath("/dettes");
  revalidatePath("/analyse");
}

async function createSocial(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");

  const row = {
    organization_id: ctx.organizationId,
    organization_name: String(fd.get("organization_name") || "").trim(),
    period_start: String(fd.get("period_start") || ""),
    period_end: String(fd.get("period_end") || ""),
    due_date: String(fd.get("due_date") || ""),
    amount: Number(fd.get("amount") || 0),
  };

  if (!Number.isFinite(row.amount) || row.amount < 0) throw new Error("Obligation invalide.");
  if (!row.period_start || !row.period_end || !row.due_date || row.period_end < row.period_start) {
    throw new Error("Période ou échéance invalide.");
  }

  const { error } = await ctx.supabase.from("social_obligations").insert(row);
  if (error) throw new Error(error.message);
  revalidatePath("/fiscalite-social");
  revalidatePath("/dettes");
  revalidatePath("/analyse");
}

export default async function TaxSocial() {
  const { supabase, organizationId } = await requireOrganization();
  const [{ data: tax = [] }, { data: social = [] }, { data: org }] = await Promise.all([
    supabase.from("tax_obligations").select("*").eq("organization_id", organizationId).order("due_date"),
    supabase.from("social_obligations").select("*").eq("organization_id", organizationId).order("due_date"),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Fiscalité & obligations sociales</h1>
          <p>Échéances paramétrées par l'entreprise. Aucun taux fiscal légal n'est codé en dur.</p>
        </div>
      </div>

      <div className="grid2">
        <section>
          <h2>Dettes fiscales</h2>
          {!tax.length ? (
            <EmptyState
              title="Aucune obligation fiscale"
              description="Ajoute les obligations applicables à ton entreprise."
            />
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Échéance</th>
                    <th>Statut</th>
                    <th className="right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {tax.map((x: any) => (
                    <tr key={x.id}>
                      <td>{x.obligation_type}</td>
                      <td>{x.due_date}</td>
                      <td>{x.status}</td>
                      <td className="right">{money(x.amount, org?.currency || "MGA")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2>Dettes sociales</h2>
          {!social.length ? (
            <EmptyState
              title="Aucune obligation sociale"
              description="Ajoute uniquement les organismes et échéances réels."
            />
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Organisme</th>
                    <th>Échéance</th>
                    <th>Statut</th>
                    <th className="right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {social.map((x: any) => (
                    <tr key={x.id}>
                      <td>{x.organization_name || "Organisme social"}</td>
                      <td>{x.due_date}</td>
                      <td>{x.status}</td>
                      <td className="right">{money(x.amount, org?.currency || "MGA")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="grid2 section">
        <div className="card">
          <h2>Ajouter une obligation fiscale</h2>
          <form action={createTax} className="form">
            <div className="field">
              <label>Type (TVA, IRSA, IR…)</label>
              <input name="obligation_type" required />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Début période</label>
                <input type="date" name="period_start" required />
              </div>
              <div className="field">
                <label>Fin période</label>
                <input type="date" name="period_end" required />
              </div>
            </div>
            <div className="field">
              <label>Échéance</label>
              <input type="date" name="due_date" required />
            </div>
            <div className="field">
              <label>Montant</label>
              <input type="number" min="0" step="0.01" name="amount" required />
            </div>
            <button className="button primary">Enregistrer</button>
          </form>
        </div>

        <div className="card">
          <h2>Ajouter une obligation sociale</h2>
          <form action={createSocial} className="form">
            <div className="field">
              <label>Organisme</label>
              <input name="organization_name" />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Début période</label>
                <input type="date" name="period_start" required />
              </div>
              <div className="field">
                <label>Fin période</label>
                <input type="date" name="period_end" required />
              </div>
            </div>
            <div className="field">
              <label>Échéance</label>
              <input type="date" name="due_date" required />
            </div>
            <div className="field">
              <label>Montant</label>
              <input type="number" min="0" step="0.01" name="amount" required />
            </div>
            <button className="button primary">Enregistrer</button>
          </form>
        </div>
      </div>
    </>
  );
}
