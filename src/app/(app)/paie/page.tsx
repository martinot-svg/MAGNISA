import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";
import { money } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";

async function createEmployee(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payroll.manage");

  const first = String(fd.get("first_name") || "").trim();
  const last = String(fd.get("last_name") || "").trim();
  if (!first || !last) throw new Error("Nom et prénom requis.");

  const base = Number(fd.get("base_salary") || 0);
  if (!Number.isFinite(base) || base < 0) throw new Error("Salaire invalide.");

  const { error } = await ctx.supabase.from("employees").insert({
    organization_id: ctx.organizationId,
    employee_number: String(fd.get("employee_number") || "") || null,
    first_name: first,
    last_name: last,
    email: String(fd.get("email") || "") || null,
    phone: String(fd.get("phone") || "") || null,
    job_title: String(fd.get("job_title") || "") || null,
    contract_type: String(fd.get("contract_type") || "") || null,
    hire_date: String(fd.get("hire_date") || "") || null,
    base_salary: base,
    payment_method: String(fd.get("payment_method") || "bank_transfer"),
  });

  if (error) throw new Error(error.message);
  revalidatePath("/paie");
}

async function createRun(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payroll.manage");

  const start = String(fd.get("period_start") || "");
  const end = String(fd.get("period_end") || "");
  if (!start || !end || end < start) throw new Error("Période invalide.");

  const { error } = await ctx.supabase.from("payroll_runs").insert({
    organization_id: ctx.organizationId,
    period_start: start,
    period_end: end,
    status: "draft",
    created_by: ctx.user.id,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/paie");
}

async function createPayslip(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payroll.manage");

  const moneyFields = [
    "bonuses",
    "overtime",
    "other_earnings",
    "employee_social",
    "employee_health",
    "income_tax",
    "advances_recovered",
    "other_deductions",
    "employer_social",
    "employer_health",
  ] as const;

  const amounts = Object.fromEntries(
    moneyFields.map((key) => [key, Number(fd.get(key) || 0)])
  ) as Record<(typeof moneyFields)[number], number>;

  if (Object.values(amounts).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Les éléments de paie doivent être des montants positifs ou nuls.");
  }

  const { error } = await ctx.supabase.rpc("create_payslip", {
    p_org: ctx.organizationId,
    p_run: String(fd.get("payroll_run_id") || ""),
    p_employee: String(fd.get("employee_id") || ""),
    p_bonuses: amounts.bonuses,
    p_overtime: amounts.overtime,
    p_other_earnings: amounts.other_earnings,
    p_employee_social: amounts.employee_social,
    p_employee_health: amounts.employee_health,
    p_income_tax: amounts.income_tax,
    p_advances_recovered: amounts.advances_recovered,
    p_other_deductions: amounts.other_deductions,
    p_employer_social: amounts.employer_social,
    p_employer_health: amounts.employer_health,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/paie");
}

async function validatePayslip(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payroll.manage");

  const { error } = await ctx.supabase.rpc("validate_payslip", {
    p_org: ctx.organizationId,
    p_payslip: String(fd.get("payslip_id") || ""),
  });

  if (error) throw new Error(error.message);
  revalidatePath("/paie");
  revalidatePath("/comptabilite");
  revalidatePath("/dettes");
  revalidatePath("/dashboard");
}

async function payPayslip(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payroll.pay");

  const amount = Number(fd.get("amount") || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Montant invalide.");

  const method = String(fd.get("method") || "bank_transfer");
  if (!["bank_transfer", "cash", "mobile_money", "cheque", "card", "other"].includes(method)) {
    throw new Error("Mode de paiement invalide.");
  }

  const { error } = await ctx.supabase.rpc("record_payroll_payment", {
    p_org: ctx.organizationId,
    p_payslip: String(fd.get("payslip_id") || ""),
    p_account: String(fd.get("financial_account_id") || ""),
    p_amount: amount,
    p_method: method,
    p_date: String(fd.get("payment_date") || ""),
    p_reference: String(fd.get("reference") || "") || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/paie");
  revalidatePath("/tresorerie");
  revalidatePath("/comptabilite");
  revalidatePath("/dashboard");
}

export default async function Payroll() {
  const { supabase, organizationId } = await requireOrganization();
  const [
    { data: org },
    { data: employees = [] },
    { data: runs = [] },
    { data: slips = [] },
    { data: accounts = [] },
  ] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("employees").select("*").eq("organization_id", organizationId).order("last_name"),
    supabase
      .from("payroll_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("period_end", { ascending: false }),
    supabase
      .from("payslips")
      .select("*,employees(first_name,last_name),payroll_runs(period_start,period_end)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("financial_accounts")
      .select("id,name,type")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("name"),
  ]);

  const c = org?.currency || "MGA";
  const editableRuns = runs.filter((r: any) => ["draft", "calculated", "review"].includes(r.status));

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Personnel & rémunérations</p>
          <h1>Personnel & Paie</h1>
          <p>
            Le calcul, la validation comptable et le paiement sont séparés. Aucun taux fiscal ou social
            n'est codé en dur.
          </p>
        </div>
      </div>

      <div className="grid3">
        <div className="card">
          <h2>Nouveau salarié</h2>
          <form action={createEmployee} className="form">
            <div className="grid2">
              <div className="field">
                <label>Prénom</label>
                <input name="first_name" required />
              </div>
              <div className="field">
                <label>Nom</label>
                <input name="last_name" required />
              </div>
              <div className="field">
                <label>Matricule</label>
                <input name="employee_number" />
              </div>
              <div className="field">
                <label>Poste</label>
                <input name="job_title" />
              </div>
              <div className="field">
                <label>Salaire de base</label>
                <input name="base_salary" type="number" min="0" step="0.01" required />
              </div>
              <div className="field">
                <label>Date d'embauche</label>
                <input name="hire_date" type="date" />
              </div>
              <div className="field">
                <label>E-mail</label>
                <input name="email" type="email" />
              </div>
              <div className="field">
                <label>Mode de paiement</label>
                <select name="payment_method">
                  <option value="bank_transfer">Virement bancaire</option>
                  <option value="mobile_money">Mobile Money</option>
                  <option value="cash">Espèces</option>
                </select>
              </div>
            </div>
            <button className="button primary">Ajouter le salarié</button>
          </form>
        </div>

        <div className="card">
          <h2>Nouvelle période de paie</h2>
          <form action={createRun} className="form">
            <div className="field">
              <label>Début</label>
              <input name="period_start" type="date" required />
            </div>
            <div className="field">
              <label>Fin</label>
              <input name="period_end" type="date" required />
            </div>
            <button className="button primary">Créer la période</button>
          </form>
        </div>

        <div className="card">
          <h2>Calculer un bulletin</h2>
          {employees.length === 0 || editableRuns.length === 0 ? (
            <p className="muted">Crée au moins un salarié et une période de paie modifiable.</p>
          ) : (
            <form action={createPayslip} className="form">
              <div className="field">
                <label>Salarié</label>
                <select name="employee_id" required>
                  {employees
                    .filter((e: any) => e.status === "active")
                    .map((e: any) => (
                      <option key={e.id} value={e.id}>
                        {e.first_name} {e.last_name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Période</label>
                <select name="payroll_run_id" required>
                  {editableRuns.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.period_start} → {r.period_end}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid2">
                <MoneyInput name="bonuses" label="Primes" />
                <MoneyInput name="overtime" label="Heures supplémentaires" />
                <MoneyInput name="other_earnings" label="Autres gains" />
                <MoneyInput name="employee_social" label="Cotisations salariales" />
                <MoneyInput name="employee_health" label="Cotisation sanitaire" />
                <MoneyInput name="income_tax" label="IRSA / retenue fiscale" />
                <MoneyInput name="advances_recovered" label="Avances récupérées" />
                <MoneyInput name="other_deductions" label="Autres retenues" />
                <MoneyInput name="employer_social" label="Charges sociales patronales" />
                <MoneyInput name="employer_health" label="Charges santé patronales" />
              </div>
              <button className="button primary">Calculer le bulletin</button>
            </form>
          )}
        </div>
      </div>

      <div className="section">
        <h2>Bulletins</h2>
        {slips.length === 0 ? (
          <EmptyState
            title="Aucun bulletin"
            description="Les bulletins calculés apparaîtront ici avec leur net à payer et leur état de règlement."
          />
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Salarié</th>
                  <th>Période</th>
                  <th>Brut</th>
                  <th>Net</th>
                  <th>Payé</th>
                  <th>Statut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {slips.map((s: any) => {
                  const remaining = Math.max(0, Number(s.net_pay) - Number(s.paid_amount));
                  return (
                    <tr key={s.id}>
                      <td>
                        {s.employees?.first_name} {s.employees?.last_name}
                      </td>
                      <td>
                        {s.payroll_runs?.period_start} → {s.payroll_runs?.period_end}
                      </td>
                      <td>{money(Number(s.gross_pay), c)}</td>
                      <td>
                        <b>{money(Number(s.net_pay), c)}</b>
                      </td>
                      <td>{money(Number(s.paid_amount), c)}</td>
                      <td>
                        <span className="badge">{s.status}</span>
                      </td>
                      <td className="right">
                        {s.status === "calculated" ? (
                          <form action={validatePayslip}>
                            <input type="hidden" name="payslip_id" value={s.id} />
                            <button className="button">Valider & comptabiliser</button>
                          </form>
                        ) : ["validated", "partially_paid"].includes(s.status) &&
                          remaining > 0 &&
                          accounts.length > 0 ? (
                          <form
                            action={payPayslip}
                            style={{ display: "grid", gridTemplateColumns: "120px 130px 150px 1fr", gap: 6 }}
                          >
                            <input type="hidden" name="payslip_id" value={s.id} />
                            <input type="date" name="payment_date" required />
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
                            <div style={{ display: "flex", gap: 6 }}>
                              <input
                                name="amount"
                                type="number"
                                step="0.01"
                                min="0.01"
                                max={remaining}
                                defaultValue={remaining}
                                required
                              />
                              <input name="reference" placeholder="Référence" />
                              <button className="button primary">Payer</button>
                            </div>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function MoneyInput({ name, label }: { name: string; label: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input name={name} type="number" min="0" step="0.01" defaultValue="0" />
    </div>
  );
}
