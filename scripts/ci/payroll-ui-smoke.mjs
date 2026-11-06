import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
const ids = {
  history: "e1000000-0000-4000-8000-000000000011",
  current: "e1000000-0000-4000-8000-000000000012",
  future: "e1000000-0000-4000-8000-000000000013",
  draft: "e1000000-0000-4000-8000-000000000014",
  invalid: "e1000000-0000-4000-8000-000000000015",
  valid: "e1000000-0000-4000-8000-000000000016",
};
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const getRule = async (id) => {
  const { data, error } = await admin.from("payroll_rule_sets")
    .select("id,status,effective_to").eq("id", id).single();
  if (error) throw error;
  return data;
};
const historySection = (page) => page.locator("div.section.card")
  .filter({ has: page.getByRole("heading", { name: "Historique des règles" }) });
const ruleRow = (page, name) => historySection(page).locator("tbody tr").filter({ hasText: name });
const openRuleActions = async (page, name) => {
  const row = ruleRow(page, name);
  await row.locator("details > summary").click();
  return row;
};
const waitForNotice = async (page, fragment) => {
  const notice = page.getByRole("status");
  await notice.waitFor();
  const content = await notice.innerText();
  assert(content.includes(fragment), `Expected notice containing "${fragment}", received "${content}"`);
};
const clickAction = async (page, button) => {
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/paie/parametres" && url.searchParams.has("result"), { timeout: 30000 }),
    button.click(),
  ]);
};
const resetPage = async (page) => {
  const response = await page.goto(`${baseUrl}/paie/parametres`, { waitUntil: "domcontentloaded" });
  try {
    await page.getByRole("heading", { name: /Paramètres de paie/ }).waitFor({ timeout: 15000 });
  } catch (error) {
    process.stdout.write("RESET PAGE URL " + page.url() + " STATUS " + response?.status() + "\\n");
    process.stdout.write("RESET PAGE BODY " + (await page.locator("body").innerText()).slice(0, 3000) + "\\n");
    throw error;
  }
};

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 30000 });

  const membershipCheck = await admin.from("organization_members")
    .select("organization_id,role,status").eq("user_id", process.env.TEST_USER_ID);
  if (membershipCheck.error) throw membershipCheck.error;
  process.stdout.write("TEST USER MEMBERSHIPS " + JSON.stringify(membershipCheck.data) + "\\n");

  const payrollResponse = await page.goto(`${baseUrl}/paie/parametres`, { waitUntil: "domcontentloaded" });
  try {
    await page.getByRole("heading", { name: /Paramètres de paie/ }).waitFor({ timeout: 15000 });
  } catch (error) {
    process.stdout.write("PAYROLL PAGE URL " + page.url() + " STATUS " + payrollResponse?.status() + "\\n");
    process.stdout.write("PAYROLL PAGE BODY " + (await page.locator("body").innerText()).slice(0, 3000) + "\\n");
    throw error;
  }
  await ruleRow(page, "UI TEST historical").waitFor();

  let row = await openRuleActions(page, "UI TEST historical");
  await clickAction(page, row.getByRole("button", { name: "Archiver ce référentiel" }));
  await waitForNotice(page, "Référentiel archivé.");
  assert((await getRule(ids.history)).status === "archived", "Historical rule was not archived.");
  process.stdout.write("PASS UI: historical archival and audit path\n");
  await resetPage(page);

  row = await openRuleActions(page, "UI TEST current");
  await clickAction(page, row.getByRole("button", { name: "Archiver ce référentiel" }));
  await waitForNotice(page, "date actuelle");
  assert((await getRule(ids.current)).status === "validated", "Current rule changed after rejected archival.");
  process.stdout.write("PASS UI: current rule archival correctly refused\n");
  await resetPage(page);

  row = await openRuleActions(page, "UI TEST future");
  await clickAction(page, row.getByRole("button", { name: "Archiver ce référentiel" }));
  await waitForNotice(page, "Référentiel archivé.");
  assert((await getRule(ids.future)).status === "archived", "Future rule was not archived.");
  process.stdout.write("PASS UI: future archival\n");
  await resetPage(page);

  row = await openRuleActions(page, "UI TEST delete draft");
  await row.locator('input[name="delete_confirmation"]').fill("SUPPRIMER");
  await clickAction(page, row.getByRole("button", { name: /Supprimer définitivement/ }));
  await waitForNotice(page, "supprimé définitivement");
  const deleted = await admin.from("payroll_rule_sets").select("id").eq("id", ids.draft).maybeSingle();
  assert(!deleted.data, "Draft rule still exists after UI deletion.");
  const deletionAudit = await admin.from("payroll_rule_change_log").select("id")
    .eq("rule_id", ids.draft).eq("action", "deleted");
  if (deletionAudit.error) throw deletionAudit.error;
  assert(deletionAudit.data.length === 1, "Draft deletion audit event is missing.");
  process.stdout.write("PASS UI: confirmed draft deletion with audit trail\n");
  await resetPage(page);

  row = await openRuleActions(page, "UI TEST invalid draft");
  await clickAction(page, row.getByRole("button", { name: "Valider et activer ce référentiel" }));
  await waitForNotice(page, "Référentiel incomplet");
  assert((await getRule(ids.invalid)).status === "draft", "Incomplete rule changed status.");
  process.stdout.write("PASS UI: incomplete validation correctly refused\n");
  await resetPage(page);

  row = await openRuleActions(page, "UI TEST valid draft");
  await clickAction(page, row.getByRole("button", { name: "Valider et activer ce référentiel" }));
  await waitForNotice(page, "Référentiel validé");
  assert((await getRule(ids.valid)).status === "validated", "Valid rule was not activated.");
  const previous = await getRule(ids.current);
  assert(previous.status === "archived", "Previous rule was not closed by valid activation.");
  process.stdout.write("PASS UI: valid rule activation and previous-period closure\n");

  assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.join(" | ")}`);
  process.stdout.write("PASS UI: no uncaught browser page errors\n");
} finally {
  await browser.close();
}
