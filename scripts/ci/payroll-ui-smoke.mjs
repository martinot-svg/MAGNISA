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
const userClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: userAuth, error: userAuthError } = await userClient.auth.signInWithPassword({
  email,
  password,
});
if (userAuthError || !userAuth.user || !userAuth.session?.access_token) {
  throw userAuthError ?? new Error("Unable to authenticate direct RLS probe.");
}
const authenticatedClient = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${userAuth.session.access_token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: directMemberships, error: directMembershipError } = await authenticatedClient
  .from("organization_members")
  .select("organization_id,role,status")
  .eq("user_id", userAuth.user.id)
  .eq("status", "active");
const jwtClaims = JSON.parse(Buffer.from(userAuth.session.access_token.split(".")[1], "base64url").toString("utf8"));
process.stdout.write("DIRECT USER JWT MEMBERSHIPS " + JSON.stringify({
  user_id: userAuth.user.id,
  jwt_sub: jwtClaims.sub,
  jwt_role: jwtClaims.role,
  count: directMemberships?.length ?? 0,
  query_error: directMembershipError?.code ?? "none",
}) + "\\n");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const getRule = async (id) => {
  const { data, error } = await admin.from("payroll_rule_sets")
    .select("id,status,effective_to").eq("id", id).single();
  if (error) throw error;
  return data;
};
const historySection = (page) => page.getByRole("dialog").locator("div.section.card")
  .filter({ has: page.getByRole("heading", { name: "Historique des règles" }) });
const openHistory = async (page) => {
  const button = page.getByRole("button", { name: "Historique des règles" });
  const dialog = page.getByRole("dialog");
  await button.waitFor({ state: "visible" });
  await button.click();
  try {
    await dialog.waitFor({ state: "visible", timeout: 2000 });
  } catch {
    await page.waitForTimeout(750);
    await button.click();
    await dialog.waitFor({ state: "visible", timeout: 10000 });
  }
  await dialog.getByRole("heading", { name: "Historique des règles" }).waitFor({ timeout: 10000 });
};
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
    await openHistory(page);
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
  await openHistory(page);
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

  const fixedAssetsResponse = await page.goto(`${baseUrl}/immobilisations`, { waitUntil: "domcontentloaded" });
  assert(fixedAssetsResponse?.ok(), `Fixed-assets route returned ${fixedAssetsResponse?.status()}`);
  await page.getByRole("heading", { name: "Registre des immobilisations" }).waitFor({ timeout: 15000 });
  await page.getByRole("heading", { name: "Planifier et comptabiliser les dotations" }).waitFor({ timeout: 10000 });
  await page.getByRole("heading", { name: "Ventilation par composants" }).waitFor({ timeout: 10000 });
  await page.getByRole("heading", { name: "Rapprochement IFRS distinct" }).waitFor({ timeout: 10000 });
  const fixedAssetRead = await authenticatedClient.from("fixed_assets").select("id").limit(1);
  if (fixedAssetRead.error) throw fixedAssetRead.error;
  const depreciationRead = await authenticatedClient.from("fixed_asset_depreciation_entries").select("id").limit(1);
  if (depreciationRead.error) throw depreciationRead.error;
  const depreciationWrite = await authenticatedClient.from("fixed_asset_depreciation_entries").insert({});
  assert(depreciationWrite.error?.code === "42501", `Authenticated user must not write depreciation schedules directly; received ${depreciationWrite.error?.code ?? "no error"}`);
  process.stdout.write("PASS UI: authenticated fixed-assets register, depreciation, component and IFRS sections\n");
  process.stdout.write("PASS RLS: authenticated read allowed and direct depreciation write denied\n");

  assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.join(" | ")}`);
  process.stdout.write("PASS UI: no uncaught browser page errors\n");
} finally {
  await browser.close();
}
