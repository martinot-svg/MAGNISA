import { requirePermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";
import { money } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";

async function createSupplier(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "suppliers.manage");

  const name = String(fd.get("name") || "").trim();
  if (name.length < 2) throw new Error("Nom fournisseur invalide.");

  const supplierType = String(fd.get("supplier_type") || "supplier");
  if (!["supplier", "subcontractor", "both"].includes(supplierType)) {
    throw new Error("Type de fournisseur invalide.");
  }

  const { error } = await ctx.supabase.from("suppliers").insert({
    organization_id: ctx.organizationId,
    name,
    email: String(fd.get("email") || "") || null,
    phone: String(fd.get("phone") || "") || null,
    supplier_type: supplierType,
    payment_terms: String(fd.get("payment_terms") || "") || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/fournisseurs");
}

async function createSupplierInvoice(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "suppliers.manage");

  const total = Number(fd.get("total") || 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("Montant invalide.");

  const supplierId = String(fd.get("supplier_id") || "");
  const supplierNumber = String(fd.get("supplier_number") || "").trim();
  const invoiceDate = String(fd.get("invoice_date") || "");
  const dueDate = String(fd.get("due_date") || "") || null;
  const notes = String(fd.get("notes") || "") || null;

  if (!supplierId || !supplierNumber || !invoiceDate) {
    throw new Error("Fournisseur, numéro et date de facture sont obligatoires.");
  }

  const { error } = await ctx.supabase.rpc("record_supplier_invoice", {
    p_org: ctx.organizationId,
    p_supplier: supplierId,
    p_supplier_number: supplierNumber,
    p_invoice_date: invoiceDate,
    p_due_date: dueDate,
    p_total: total,
    p_notes: notes,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/fournisseurs");
  revalidatePath("/dettes");
  revalidatePath("/comptabilite");
  revalidatePath("/dashboard");
}

async function paySupplier(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "suppliers.manage");

  const amount = Number(fd.get("amount") || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Montant invalide.");

  const method = String(fd.get("method") || "bank_transfer");
  if (!["bank_transfer", "cash", "mobile_money", "cheque", "card", "other"].includes(method)) {
    throw new Error("Mode de paiement invalide.");
  }

  const { error } = await ctx.supabase.rpc("record_supplier_payment", {
    p_org: ctx.organizationId,
    p_supplier_invoice: String(fd.get("supplier_invoice_id") || ""),
    p_account: String(fd.get("financial_account_id") || ""),
    p_amount: amount,
    p_method: method,
    p_date: String(fd.get("payment_date") || ""),
    p_reference: String(fd.get("reference") || "") || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/fournisseurs");
  revalidatePath("/dettes");
  revalidatePath("/tresorerie");
  revalidatePath("/comptabilite");
  revalidatePath("/dashboard");
}

export default async function Suppliers(){const ctx=await requireOrganization();await requirePermission(ctx,"suppliers.view");const {supabase,organizationId}=ctx;
  const [{ data: org }, { data: suppliers = [] }, { data: invoices = [] }, { data: accounts = [] }] =
    await Promise.all([
      supabase.from("organizations").select("currency").eq("id", organizationId).single(),
      supabase.from("suppliers").select("*").eq("organization_id", organizationId).order("name"),
      supabase
        .from("supplier_invoices")
        .select("*,suppliers(name)")
        .eq("organization_id", organizationId)
        .order("invoice_date", { ascending: false }),
      supabase
        .from("financial_accounts")
        .select("id,name,type")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name"),
    ]);

  const c = org?.currency || "MGA";

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Achats & sous-traitance</p>
          <h1>Fournisseurs</h1>
          <p>Centralise les prestataires, sous-traitants, factures fournisseurs et dettes associées.</p>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Nouveau fournisseur</h2>
          <form action={createSupplier} className="form">
            <div className="field">
              <label>Nom</label>
              <input name="name" required />
            </div>
            <div className="grid2">
              <div className="field">
                <label>Type</label>
                <select name="supplier_type">
                  <option value="supplier">Fournisseur</option>
                  <option value="subcontractor">Sous-traitant</option>
                  <option value="both">Les deux</option>
                </select>
              </div>
              <div className="field">
                <label>E-mail</label>
                <input name="email" type="email" />
              </div>
              <div className="field">
                <label>Téléphone</label>
                <input name="phone" />
              </div>
            </div>
            <div className="field">
              <label>Conditions de paiement</label>
              <textarea name="payment_terms" />
            </div>
            <button className="button primary">Ajouter</button>
          </form>
        </div>

        <div className="card">
          <h2>Facture fournisseur</h2>
          {suppliers.length === 0 ? (
            <p className="muted">Ajoute d'abord un fournisseur.</p>
          ) : (
            <form action={createSupplierInvoice} className="form">
              <div className="field">
                <label>Fournisseur</label>
                <select name="supplier_id" required>
                  {suppliers.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid2">
                <div className="field">
                  <label>N° facture fournisseur</label>
                  <input name="supplier_number" required />
                </div>
                <div className="field">
                  <label>Montant total</label>
                  <input name="total" type="number" min="0.01" step="0.01" required />
                </div>
                <div className="field">
                  <label>Date facture</label>
                  <input name="invoice_date" type="date" required />
                </div>
                <div className="field">
                  <label>Échéance</label>
                  <input name="due_date" type="date" />
                </div>
              </div>
              <div className="field">
                <label>Notes</label>
                <textarea name="notes" />
              </div>
              <button className="button primary">Enregistrer et comptabiliser</button>
            </form>
          )}
        </div>
      </div>

      <div className="section">
        <h2>Dettes fournisseurs</h2>
        {invoices.length === 0 ? (
          <EmptyState
            title="Aucune facture fournisseur"
            description="Les dettes fournisseurs apparaîtront ici lorsqu'elles seront enregistrées."
          />
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Fournisseur</th>
                  <th>Référence</th>
                  <th>Échéance</th>
                  <th>Statut</th>
                  <th>Total</th>
                  <th>Reste dû</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((x: any) => (
                  <tr key={x.id}>
                    <td>{x.suppliers?.name}</td>
                    <td>{x.supplier_number}</td>
                    <td>{x.due_date || "—"}</td>
                    <td>
                      <span className="badge">{x.status}</span>
                    </td>
                    <td>{money(Number(x.total), c)}</td>
                    <td>{money(Number(x.balance_due), c)}</td>
                    <td className="right">
                      {Number(x.balance_due) > 0 && accounts.length > 0 ? (
                        <form
                          action={paySupplier}
                          style={{ display: "flex", gap: 6, justifyContent: "flex-end", minWidth: 420 }}
                        >
                          <input type="hidden" name="supplier_invoice_id" value={x.id} />
                          <input name="payment_date" type="date" required />
                          <select name="financial_account_id" required>
                            {accounts.map((a: any) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                          <select name="method" defaultValue="bank_transfer">
                            <option value="bank_transfer">Virement</option>
                            <option value="cash">Espèces</option>
                            <option value="mobile_money">Mobile Money</option>
                            <option value="cheque">Chèque</option>
                            <option value="card">Carte</option>
                            <option value="other">Autre</option>
                          </select>
                          <input
                            name="amount"
                            type="number"
                            min="0.01"
                            step="0.01"
                            max={Number(x.balance_due)}
                            defaultValue={Number(x.balance_due)}
                            required
                          />
                          <input name="reference" placeholder="Référence" />
                          <button className="button">Payer</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
