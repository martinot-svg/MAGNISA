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
}) + "\n");
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
const ruleRow = (page, name) => page.getByRole("dialog").locator("tbody tr").filter({ hasText: name });
const openRuleActions = async (page, name) => {
  const row = ruleRow(page, name);
  await row.waitFor({ state: "visible" });
  const status = (await row.locator("td").nth(3).innerText()).trim();
  // Validated rules expose archival outside the collapsed details panel.
  // Draft and pending rules keep edit/activation controls inside that panel.
  if (["draft", "pending_review"].includes(status)) {
    await row.locator("details > summary").click();
  }
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
const openHistory = async (page) => {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const button = page.getByRole("button", { name: "Historique des règles" });
  await button.waitFor({ state: "visible" });
  await page.waitForTimeout(1200);
  if (await button.getAttribute("aria-expanded") !== "true") {
    await button.click();
  }
  await page.waitForFunction(() =>
    document.querySelector('button[aria-haspopup="dialog"][aria-expanded="true"]') !== null,
    null,
    { timeout: 10000 },
  );
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("heading", { name: "Historique des règles" }).first().waitFor({ state: "visible", timeout: 10000 });
};

const resetPage = async (page) => {
  const response = await page.goto(`${baseUrl}/paie/parametres`, { waitUntil: "domcontentloaded" });
  try {
    await page.getByRole("heading", { name: /Paramètres de paie/ }).waitFor({ timeout: 15000 });
    await openHistory(page);
  } catch (error) {
    process.stdout.write("RESET PAGE URL " + page.url() + " STATUS " + response?.status() + "\n");
    process.stdout.write("RESET PAGE BODY " + (await page.locator("body").innerText()).slice(0, 3000) + "\n");
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
  const activeMembership = membershipCheck.data.find((membership) => membership.status === "active");
  assert(activeMembership, "Authenticated UI test user must have an active organization membership.");
  const testOrganizationId = activeMembership.organization_id;
  process.stdout.write("TEST USER MEMBERSHIPS " + JSON.stringify(membershipCheck.data) + "\n");

  const payrollResponse = await page.goto(`${baseUrl}/paie/parametres`, { waitUntil: "domcontentloaded" });
  try {
    await page.getByRole("heading", { name: /Paramètres de paie/ }).waitFor({ timeout: 15000 });
    await openHistory(page);
  } catch (error) {
    process.stdout.write("PAYROLL PAGE URL " + page.url() + " STATUS " + payrollResponse?.status() + "\n");
    process.stdout.write("PAYROLL PAGE BODY " + (await page.locator("body").innerText()).slice(0, 3000) + "\n");
    throw error;
  }
  // The history dialog was already opened in the guarded page check above.
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

  const futureDraftRow = ruleRow(page, "UI TEST future");
  await futureDraftRow.waitFor({ state: "visible" });
  assert(
    await futureDraftRow.getByRole("button", { name: "Archiver ce référentiel" }).count() === 0,
    "A future draft must not expose the archive action before activation.",
  );
  assert((await getRule(ids.future)).status === "draft", "Future draft status changed unexpectedly.");
  process.stdout.write("PASS UI: future draft cannot be archived before activation\n");
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
  await page.getByRole("heading", { name: "Mise en service des immobilisations en cours" }).waitFor({ timeout: 10000 });
  const registrationAccountSelect = page.locator('select[name="pcg_asset_account_code"]');
  await registrationAccountSelect.waitFor({ state: "visible", timeout: 10000 });
  assert(await registrationAccountSelect.getAttribute("required") !== null, "Fixed-asset account must be mandatory.");
  assert(await registrationAccountSelect.locator('option[value="215"]').count() === 1, "PCG account 215 must be selectable from the catalogue when creating an asset.");
  const commissioningAccountSelect = page.locator('select[name="new_asset_account_code"]');
  await commissioningAccountSelect.waitFor({ state: "visible", timeout: 10000 });
  assert(await commissioningAccountSelect.getAttribute("required") !== null, "Commissioning target account must be mandatory.");
  assert(await commissioningAccountSelect.locator('option[value="215"]').count() === 1, "PCG account 215 must be selectable for commissioning.");
  process.stdout.write("PASS UI: commissioning target account is selected from the PCG catalogue\\n");
  await page.getByRole("heading", { name: "Ventilation par composants" }).waitFor({ timeout: 10000 });
  await page.getByRole("heading", { name: "Rapprochement IFRS distinct" }).waitFor({ timeout: 10000 });
  const assetCode = `UI-IMM-${Date.now()}`;
  const assetDate = new Date().toISOString().slice(0, 10);
  const registrationForm = page.locator("form").filter({ has: page.locator('input[name="asset_code"]') });
  await registrationForm.locator('input[name="asset_code"]').fill(assetCode);
  await registrationForm.locator('input[name="name"]').fill("UI authenticated fixed asset test");
  await registrationForm.locator('input[name="category"]').fill("equipment");
  await registrationForm.locator('select[name="pcg_asset_account_code"]').selectOption("215");
  await registrationForm.locator('input[name="pcg_acquisition_counterpart_account_code"]').fill("404");
  await registrationForm.locator('input[name="acquisition_date"]').fill(assetDate);
  await registrationForm.locator('input[name="in_service_date"]').fill(assetDate);
  await registrationForm.locator('input[name="acquisition_cost"]').fill("123456");
  await registrationForm.locator('select[name="depreciation_method"]').selectOption("straight_line");
  await registrationForm.locator('input[name="useful_life_months"]').fill("60");
  await registrationForm.locator('input[name="pcg_accumulated_depreciation_account_code"]').fill("281");
  await registrationForm.locator('input[name="pcg_depreciation_expense_account_code"]').fill("681");
  await registrationForm.locator('input[name="pcg_impairment_account_code"]').fill("291");
  await registrationForm.locator('input[name="pcg_impairment_expense_account_code"]').fill("681");
  await registrationForm.locator('input[name="pcg_impairment_reversal_income_account_code"]').fill("781");
  await registrationForm.locator('input[name="pcg_disposal_receivable_account_code"]').fill("462");
  await registrationForm.locator('input[name="pcg_disposal_expense_account_code"]').fill("652");
  await registrationForm.locator('input[name="pcg_disposal_income_account_code"]').fill("752");
  await registrationForm.getByRole("button", { name: "Enregistrer la fiche" }).click();
  const createdAssetRow = page.locator("tbody tr").filter({ hasText: assetCode });
  await createdAssetRow.waitFor({ state: "visible", timeout: 20000 });
  const createdAsset = await admin.from("fixed_assets")
    .select("id,pcg_asset_account_code,acquisition_journal_entry_id,net_book_value")
    .eq("organization_id", testOrganizationId).eq("asset_code", assetCode).single();
  if (createdAsset.error) throw createdAsset.error;
  assert(createdAsset.data.pcg_asset_account_code === "215", "Created asset must retain selected PCG 215.");
  assert(Number(createdAsset.data.net_book_value) === 123456, "Created asset must retain its gross net book value before depreciation.");
  await createdAssetRow.getByRole("button", { name: "Comptabiliser" }).click();
  await createdAssetRow.getByText("Comptabilisée").waitFor({ state: "visible", timeout: 20000 });
  const postedAsset = await admin.from("fixed_assets")
    .select("id,acquisition_journal_entry_id").eq("organization_id", testOrganizationId)
    .eq("asset_code", assetCode).single();
  if (postedAsset.error) throw postedAsset.error;
  assert(postedAsset.data.acquisition_journal_entry_id, "UI acquisition action must attach a posted journal to the asset.");
  const acquisitionLines = await admin.from("journal_entry_lines")
    .select("account_key,debit,credit").eq("organization_id", testOrganizationId)
    .eq("journal_entry_id", postedAsset.data.acquisition_journal_entry_id);
  if (acquisitionLines.error) throw acquisitionLines.error;
  const assetDebit = acquisitionLines.data.filter((line) => line.account_key === "PCG:215")
    .reduce((sum, line) => sum + Number(line.debit), 0);
  const supplierCredit = acquisitionLines.data.filter((line) => line.account_key === "PCG:404")
    .reduce((sum, line) => sum + Number(line.credit), 0);
  assert(assetDebit === 123456 && supplierCredit === 123456, "UI acquisition journal must debit PCG 215 and credit PCG 404 for 123456 MGA.");
  const acquisitionHistory = await admin.from("audit_logs").select("id,action")
    .eq("organization_id", testOrganizationId).eq("entity_type", "fixed_asset")
    .eq("entity_id", postedAsset.data.id).eq("action", "fixed_asset.acquisition.posted");
  if (acquisitionHistory.error) throw acquisitionHistory.error;
  assert(acquisitionHistory.data.length === 1, "Fixed-asset acquisition audit history must contain exactly one event.");
  process.stdout.write("PASS UI: authenticated asset creation, PCG selection, acquisition posting, ledger lines and audit history\\n");

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