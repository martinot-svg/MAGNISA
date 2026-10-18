import Link from "next/link";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, requirePermission } from "@/lib/permissions";
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

  const dependants=Number(fd.get("irsa_dependants") || 0);
  if (!Number.isInteger(dependants) || dependants<0 || dependants>30) throw new Error("Nombre de personnes à charge invalide.");

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
    irsa_dependants: dependants,
    payment_method: String(fd.get("payment_method") || "bank_transfer"),
  });

  if (error) throw new Error(error.message);
  revalidatePath("/paie");
}

async function updateEmployeeDependants(fd: FormData) {
  "use server";
  const ctx=await requireOrganization();
  await assertPermission(ctx,"payroll.manage");
  const id=String(fd.get("employee_id")||"");
  const count=Number(fd.get("irsa_dependants"));
  if (!id || !Number.isInteger(count) || count<0 || count>30) throw new Error("Nombre de personnes à charge invalide.");
  const {error}=await ctx.supabase.from("employees").update({irsa_dependants:count}).eq("organization_id",ctx.organizationId).eq("id",id);
  if(error) throw new Error(error.message);
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

  const runId=String(fd.get("payroll_run_id")||"");
  const employeeId=String(fd.get("employee_id")||"");
  const [{data:run,error:runError},{data:employee,error:employeeError}]=await Promise.all([
    ctx.supabase.from("payroll_runs").select("period_end").eq("organization_id",ctx.organizationId).eq("id",runId).single(),
    ctx.supabase.from("employees").select("base_salary,irsa_dependants").eq("organization_id",ctx.organizationId).eq("id",employeeId).single(),
  ]);
  if(runError||employeeError||!run||!employee)throw new Error("Salarié ou période introuvable.");
  const {data:rules,error:ruleError}=await ctx.supabase.from("payroll_rule_sets").select("*").eq("organization_id",ctx.organizationId).eq("status","validated").lte("effective_from",run.period_end).order("effective_from",{ascending:false});
  if(ruleError)throw new Error(ruleError.message);
  const applicable=(rules||[]).filter((r:any)=>!r.effective_to||r.effective_to>=run.period_end);
  if(applicable.length!==1)throw new Error("Le calcul automatique exige un unique référentiel réglementaire validé pour cette période. Consulte Paramètres de paie - Madagascar.");
  const rule=applicable[0];
  if(rule.rounding_policy!=="floor_100"||!Array.isArray(rule.irsa_brackets)||rule.irsa_brackets.length===0||rule.cnaps_monthly_ceiling==null||rule.health_monthly_ceiling==null)throw new Error("Référentiel incomplet : l'IRSA, les arrondis et les plafonds doivent être contrôlés avant calcul.");
  const baseSalary=Number(employee.base_salary);
  if (!Number.isFinite(baseSalary) || baseSalary < 0) throw new Error("Salaire de base invalide.");
  const gross=baseSalary+amounts.bonuses+amounts.overtime+amounts.other_earnings;
  if (!Number.isFinite(gross) || gross < 0) throw new Error("Salaire brut invalide.");
  for (const key of ["cnaps_monthly_ceiling","health_monthly_ceiling","cnaps_employee_rate","cnaps_employer_rate","health_employee_rate","health_employer_rate","fmfp_employer_rate"] as const) {
    const value=Number(rule[key]);
    if (!Number.isFinite(value) || value < 0 || (key.endsWith("_rate") && value > 1)) throw new Error("Paramètre réglementaire invalide : "+key);
  }
  const cnapsBase=Math.min(gross,Number(rule.cnaps_monthly_ceiling));
  const healthBase=Math.min(gross,Number(rule.health_monthly_ceiling));
  const social=Math.round(cnapsBase*Number(rule.cnaps_employee_rate)*100)/100;
  const health=Math.round(healthBase*Number(rule.health_employee_rate)*100)/100;
  const taxable=Math.floor(Math.max(0,gross-social-health)/100)*100;
  let incomeTax=0;let previous=0;
  for(const bracket of rule.irsa_brackets as {up_to:number|null;rate:number}[]){const cap=bracket.up_to==null?Infinity:Number(bracket.up_to);const rate=Number(bracket.rate);if(!Number.isFinite(rate)||rate<0||rate>1||!(cap>previous))throw new Error("Barème IRSA invalide.");incomeTax+=Math.max(0,Math.min(taxable,cap)-previous)*rate;previous=cap;if(taxable<=cap)break;}
  // Un barème sans tranche couvrant le revenu imposable ne doit jamais produire une taxe sous-estimée.
  if (taxable > previous) throw new Error("Barème IRSA incomplet : aucune tranche ne couvre le revenu imposable.");
  const minimumIrsa = Number(rule.irsa_minimum);
  if (!Number.isFinite(minimumIrsa) || minimumIrsa < 0) throw new Error("Minimum IRSA invalide.");
  incomeTax=Math.max(minimumIrsa,Math.round(incomeTax*100)/100);
  const dependants=Number(employee.irsa_dependants);
  if (!Number.isInteger(dependants) || dependants<0 || dependants>30) throw new Error("Personnes à charge IRSA invalides.");
  if (taxable>350000 && dependants>0) incomeTax=Math.max(minimumIrsa,incomeTax-2000*dependants);
  amounts.employee_social=social;amounts.employee_health=health;amounts.income_tax=incomeTax;
  amounts.employer_social=Math.round(cnapsBase*Number(rule.cnaps_employer_rate)*100)/100;
  amounts.employer_health=Math.round(healthBase*Number(rule.health_employer_rate)*100)/100;
  if(gross-social-health-incomeTax-amounts.advances_recovered-amounts.other_deductions<0)throw new Error("Le net calculé serait négatif.");
  // Le FMFP est calculé côté Supabase à partir du référentiel validé et comptabilisé séparément.
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

  const requestKey = String(fd.get("idempotency_key") || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) throw new Error("Cle de requete invalide.");
  const { error } = await ctx.supabase.rpc("lot2_record_payroll_payment_idempotent", {
    p_org: ctx.organizationId,
    p_payslip: String(fd.get("payslip_id") || ""),
    p_request_key: requestKey,
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
  const ctx = await requireOrganization();
  await requirePermission(ctx, "payroll.view");
  const { supabase, organizationId } = ctx;
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
        <Link className="button" href="/paie/parametres">Paramètres de paie - Madagascar</Link>
      </div>

      {employees.length>0 && <div className="card section">
        <h2>Personnes à charge IRSA - salariés existants</h2>
        <p className="muted">Indiquer uniquement le nombre de personnes éligibles avec justificatifs. La modification n'affecte pas les bulletins historiques.</p>
        <div className="tableWrap"><table><thead><tr><th>Salarié</th><th>Personnes à charge</th><th>Action</th></tr></thead><tbody>
          {employees.map((e:any)=><tr key={e.id}><td>{e.first_name} {e.last_name}</td><td>{e.irsa_dependants??0}</td><td>
            <form action={updateEmployeeDependants} style={{display:"flex",gap:8,alignItems:"center"}}>
              <input type="hidden" name="employee_id" value={e.id}/>
              <input aria-label="Personnes à charge IRSA" type="number" name="irsa_dependants" min="0" max="30" step="1" defaultValue={e.irsa_dependants??0} required style={{width:80}}/>
              <button className="button">Mettre à jour</button>
            </form></td></tr>)}
        </tbody></table></div>
      </div>}
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
                <label>Personnes à charge IRSA éligibles</label><input name="irsa_dependants" type="number" min="0" max="30" step="1" defaultValue="0" required /><small>Vérifier les justificatifs et l’attribution des allocations familiales.</small></div><div className="field"><label>Date d'embauche</label>
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
                <MoneyInput name="advances_recovered" label="Avances récupérées" />
                <MoneyInput name="other_deductions" label="Autres retenues" />
              </div>
              <p className="muted">CNaPS, santé et IRSA sont calculés automatiquement selon le référentiel validé. Le calcul est refusé si les règles réglementaires sont incomplètes. Les primes et heures restent variables.</p><button className="button primary">Calculer le bulletin</button>
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
                  <th>Document</th>
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
                      <td className="right"><Link className="button" href={`/paie/bulletins/${s.id}`}>Ouvrir le bulletin</Link></td><td className="right">
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
                            <input type="hidden" name="idempotency_key" value={randomUUID()} />
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
