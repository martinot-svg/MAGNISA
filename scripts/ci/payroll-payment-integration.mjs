import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.TEST_USER_ID;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

if (!url || !anonKey || !serviceKey || !userId || !email || !password) {
  throw new Error("Missing isolated payroll payment integration-test environment.");
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const user = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const signedIn = await user.auth.signInWithPassword({ email, password });
if (signedIn.error || signedIn.data.user?.id !== userId) {
  throw signedIn.error ?? new Error("Payroll payment test authentication mismatch.");
}

const membership = await admin.from("organization_members")
  .select("organization_id").eq("user_id", userId).eq("status", "active").single();
if (membership.error) throw membership.error;
const organizationId = membership.data.organization_id;
const suffix = crypto.randomUUID();
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const rpc = async (name, args) => {
  const result = await user.rpc(name, args);
  if (result.error) throw new Error(name + ": " + result.error.message);
  return result.data;
};

const employeeRows = await admin.from("employees").insert([
  {
    organization_id: organizationId,
    employee_number: `CI-PAY-A-${suffix.slice(0, 8)}`,
    first_name: "CI Payroll",
    last_name: "First",
    base_salary: 100000,
    hire_date: "2026-01-01",
    status: "active",
  },
  {
    organization_id: organizationId,
    employee_number: `CI-PAY-B-${suffix.slice(0, 8)}`,
    first_name: "CI Payroll",
    last_name: "Second",
    base_salary: 100000,
    hire_date: "2026-01-01",
    status: "active",
  },
]).select("id");
if (employeeRows.error || employeeRows.data?.length !== 2) {
  throw employeeRows.error ?? new Error("Could not create payroll integration employees.");
}

// Select a free period instead of colliding with the other payroll CI fixtures
// or a previous run when this integration test is retried.
const existingRuns = await admin.from("payroll_runs")
  .select("period_start,period_end").eq("organization_id", organizationId);
if (existingRuns.error) throw existingRuns.error;
const usedPeriods = new Set(
  (existingRuns.data ?? []).map(row => `${row.period_start}|${row.period_end}`)
);
const dateAtOffset = days => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const findFreePeriod = (startOffset) => {
  for (let offset = startOffset; offset < 1000; offset += 1) {
    const candidateStart = dateAtOffset(offset);
    const candidateEnd = dateAtOffset(offset + 1);
    const key = `${candidateStart}|${candidateEnd}`;
    if (!usedPeriods.has(key)) {
      usedPeriods.add(key);
      return { start: candidateStart, end: candidateEnd };
    }
  }
  throw new Error("Could not find an unused payroll period for the integration test.");
};
const { start: periodStart, end: periodEnd } = findFreePeriod(3);

const legacyRun = await admin.from("payroll_runs").insert({
  organization_id: organizationId,
  period_start: periodStart,
  period_end: periodEnd,
  status: "draft",
  created_by: userId,
}).select("id").single();
if (legacyRun.error) throw legacyRun.error;
const legacyCreate = await user.rpc("create_payslip", {
  p_org: organizationId,
  p_run: legacyRun.data.id,
  p_employee: employeeRows.data[0].id,
  p_bonuses: 0,
  p_overtime: 0,
  p_other_earnings: 0,
  p_employee_social: 0,
  p_employee_health: 0,
  p_income_tax: 0,
  p_advances_recovered: 0,
  p_other_deductions: 0,
  p_employer_social: 0,
  p_employer_health: 0,
});
assert(legacyCreate.error?.code === "42501",
  `Snapshot-less create_payslip must be denied by PostgreSQL privileges; received ${legacyCreate.error?.code ?? "no error"}: ${legacyCreate.error?.message ?? "none"}`);
const legacySlips = await admin.from("payslips").select("id").eq("payroll_run_id", legacyRun.data.id);
if (legacySlips.error) throw legacySlips.error;
assert(legacySlips.data.length === 0, "Rejected legacy RPC must not create a snapshot-less payslip.");

// Reuse the same draft run after the intentionally rejected legacy RPC.
const run = { data: { id: legacyRun.data.id, status: "draft" } };

const fiscalSnapshot = {
  schemaVersion: 1,
  calculatedAt: new Date().toISOString(),
  payrollRuleSet: { name: "CI payroll validated rule fixture" },
  calculation: { taxableBase: 100000, taxableCompensation: 100000 },
  overtime: {},
};
const slips = [];
for (const employee of employeeRows.data) {
  const createdSlip = await user.rpc("create_payslip", {
    p_org: organizationId,
    p_run: run.data.id,
    p_employee: employee.id,
    p_bonuses: 0,
    p_overtime: 0,
    p_other_earnings: 0,
    p_employee_social: 0,
    p_employee_health: 0,
    p_income_tax: 5000,
    p_advances_recovered: 0,
    p_other_deductions: 0,
    p_employer_social: 1000,
    p_employer_health: 5000,
    p_taxable_supplementary_pension: 0,
    p_employee_supplementary_pension: 0,
    p_taxable_compensation: 100000,
    p_fiscal_snapshot: fiscalSnapshot,
  });
  if (createdSlip.error || !createdSlip.data) {
    throw createdSlip.error ?? new Error("Snapshot-aware payslip creation returned no identifier.");
  }
  const validation = await user.rpc("validate_payslip", {
    p_org: organizationId,
    p_payslip: createdSlip.data,
  });
  if (validation.error) throw validation.error;
  slips.push({ id: createdSlip.data, employee_id: employee.id });
}
assert(slips.length === 2, "Two validated payslips must be created through the authenticated payroll RPC.");
const account = await admin.from("financial_accounts").insert({
  organization_id: organizationId,
  name: `CI payroll payment account ${suffix.slice(0, 8)}`,
  type: "bank",
  balance: 500000,
  is_active: true,
}).select("id").single();
if (account.error) throw account.error;

const paymentArgs = (payslipId, amount, requestKey, reference) => ({
  p_org: organizationId,
  p_payslip: payslipId,
  p_account: account.data.id,
  p_amount: amount,
  p_method: "bank_transfer",
  p_date: periodEnd,
  p_reference: reference,
  p_request_key: requestKey,
});

const firstKey = crypto.randomUUID();
const firstPayment = await rpc("lot2_record_payroll_payment_idempotent",
  paymentArgs(slips[0].id, 95000, firstKey, `CI-PAY-${suffix}-A`));
const repeatedFirstPayment = await rpc("lot2_record_payroll_payment_idempotent",
  paymentArgs(slips[0].id, 95000, firstKey, `CI-PAY-${suffix}-A`));
assert(firstPayment === repeatedFirstPayment, "Payroll payment idempotency must return the same payment id.");

const afterFirst = await admin.from("payroll_runs").select("status").eq("id", run.data.id).single();
if (afterFirst.error) throw afterFirst.error;
assert(afterFirst.data.status === "partially_paid",
  "A run with one paid payslip and one unpaid payslip must remain partially_paid.");

const secondKey = crypto.randomUUID();
await rpc("lot2_record_payroll_payment_idempotent",
  paymentArgs(slips[1].id, 38000, secondKey, `CI-PAY-${suffix}-B1`));
const afterPartial = await admin.from("payroll_runs").select("status").eq("id", run.data.id).single();
if (afterPartial.error) throw afterPartial.error;
assert(afterPartial.data.status === "partially_paid",
  "A run with a partially paid payslip must remain partially_paid.");

const thirdKey = crypto.randomUUID();
await rpc("lot2_record_payroll_payment_idempotent",
  paymentArgs(slips[1].id, 57000, thirdKey, `CI-PAY-${suffix}-B2`));

const [finalRun, finalSlips, finalPayments] = await Promise.all([
  admin.from("payroll_runs").select("status").eq("id", run.data.id).single(),
  admin.from("payslips").select("status,paid_amount").eq("payroll_run_id", run.data.id),
  admin.from("payroll_payments").select("id,amount").in("payslip_id", slips.map(s => s.id)),
]);
if (finalRun.error) throw finalRun.error;
if (finalSlips.error) throw finalSlips.error;
if (finalPayments.error) throw finalPayments.error;
assert(finalRun.data.status === "paid", "The payroll run must become paid only when all active payslips are paid.");
assert(finalSlips.data.length === 2 && finalSlips.data.every(s => s.status === "paid" && Number(s.paid_amount) === 95000),
  "Both payslips must be fully paid.");
assert(finalPayments.data.length === 3, "Idempotent retry must not create a duplicate payroll payment.");
assert(finalPayments.data.reduce((sum, payment) => sum + Number(payment.amount), 0) === 190000,
  "Payroll payments must reconcile to the total net payable.");

const cancelledRun = await admin.from("payroll_runs")
  .update({ status: "cancelled" }).eq("id", run.data.id).eq("organization_id", organizationId)
  .select("id").single();
if (cancelledRun.error) throw cancelledRun.error;
const cancelledAttempt = await user.rpc("lot2_record_payroll_payment_idempotent", paymentArgs(
  slips[0].id, 1, crypto.randomUUID(), `CI-PAY-CANCELLED-${suffix}`,
));
assert(!!cancelledAttempt.error && cancelledAttempt.error.message.includes("annulé"),
  "Payments against cancelled payroll runs must be rejected.");
const cancelledPaymentRows = await admin.from("payroll_payments").select("id")
  .eq("payslip_id", slips[0].id);
if (cancelledPaymentRows.error) throw cancelledPaymentRows.error;
assert(cancelledPaymentRows.data.length === 1, "Cancelled payroll run must not create an additional payment.");

process.stdout.write("PASS payroll payment integration: partial/full run status, multiple payslips, idempotency and cancelled-run guard\\n");
