import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import {assertPermission, requirePermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { transferFunds } from "@/server/actions/core";

async function createAccount(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "treasury.transfer");

  const name = String(fd.get("name") || "").trim();
  const type = String(fd.get("type") || "");
  if (!name) throw new Error("Nom requis.");
  if (!["bank", "cash", "mobile_money", "cheque_clearing"].includes(type)) {
    throw new Error("Type de compte invalide.");
  }

  const { error } = await ctx.supabase.from("financial_accounts").insert({
    organization_id: ctx.organizationId,
    name,
    type,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/tresorerie");
  revalidatePath("/dashboard");
}

export default async function Treasury(){const ctx=await requireOrganization();await requirePermission(ctx,"treasury.view");const {supabase,organizationId}=ctx;
  const [{ data: accounts = [] }, { data: org }] = await Promise.all([
    supabase
      .from("financial_accounts")
      .select("id,name,type,balance,is_active")
      .eq("organization_id", organizationId)
      .order("name"),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Trésorerie</h1>
          <p>Banque, caisse, Mobile Money, chèques et transferts internes.</p>
        </div>
      </div>

      <div className="twoCols">
        <section>
          {!accounts.length ? (
            <EmptyState
              title="Aucun compte financier"
              description="Crée le compte réel de l'entreprise. Aucun solde fictif n'est préchargé."
            />
          ) : (
            <div className="grid2">
              {accounts.map((a: any) => (
                <div className="card" key={a.id}>
                  <div className="muted">{a.type}</div>
                  <h3>{a.name}</h3>
                  <div className="metric">{money(a.balance, org?.currency || "MGA")}</div>
                  {!a.is_active && <div className="muted">Compte inactif</div>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Nouveau compte</h2>
          <p className="muted">
            Le solde n'est jamais saisi manuellement : il évolue uniquement par les opérations enregistrées.
          </p>
          <form action={createAccount} className="form">
            <div className="field">
              <label>Nom du compte</label>
              <input name="name" required />
            </div>
            <div className="field">
              <label>Type</label>
              <select name="type">
                <option value="bank">Banque</option>
                <option value="cash">Caisse</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="cheque_clearing">Chèques à encaisser</option>
              </select>
            </div>
            <button className="button primary">Créer le compte</button>
          </form>
        </section>
      </div>

      {accounts.filter((a: any) => a.is_active).length >= 2 && (
        <div className="card section">
          <h2>Transfert interne</h2>
          <p className="muted">
            Un transfert déplace la trésorerie entre deux comptes sans créer de chiffre d'affaires ni de charge.
          </p>
          <form action={transferFunds} className="form">
            <div className="grid2">
              <div className="field">
                <label>Depuis</label>
                <select name="from" required>
                  <option value="">Sélectionner</option>
                  {accounts
                    .filter((a: any) => a.is_active)
                    .map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Vers</label>
                <select name="to" required>
                  <option value="">Sélectionner</option>
                  {accounts
                    .filter((a: any) => a.is_active)
                    .map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Montant</label>
                <input name="amount" type="number" min="0.01" step="0.01" required />
              </div>
              <div className="field">
                <label>Date</label>
                <input name="date" type="date" required />
              </div>
            </div>
            <div className="field">
              <label>Référence</label>
              <input name="reference" />
            </div>
            <button className="button primary">Transférer</button>
          </form>
        </div>
      )}
    </>
  );
}
