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


  const { data: regulatoryEvent, error: regulatoryInsertError } = await admin
    .from("regulatory_watch_events")
    .insert({
      organization_id: testOrganizationId,
      source_key: "dgi-legislation",
      source_title: "UI TEST regulatory event",
      source_url: "https://www.impots.mg/ui-test",
      current_hash: "ui-test-" + Date.now(),
      current_excerpt: "Texte réglementaire de test.",
    })
    .select("id")
    .single();
  if (regulatoryInsertError) throw regulatoryInsertError;
  const regulatoryResponse = await page.goto(`${baseUrl}/paie/veille-reglementaire`, { waitUntil: "domcontentloaded" });
  assert(regulatoryResponse?.ok(), `Regulatory-watch route returned ${regulatoryResponse?.status()}`);
  await page.getByRole("heading", { name: "Veille réglementaire automatique" }).waitFor({ timeout: 15000 });
  // The route can render its server HTML before client event handlers hydrate in next dev.
  // Wait for the page to become network-idle before exercising the client-side modal trigger.
  await page.waitForLoadState("networkidle", { timeout: 15000 });
  const regulatoryRow = page.locator("tbody tr").filter({ hasText: "UI TEST regulatory event" }).first();
  await regulatoryRow.getByRole("button", { name: "Examiner" }).click();
  const regulatoryDialog = page.getByRole("dialog");
  await regulatoryDialog.waitFor({ state: "visible" });
  const closeButton = regulatoryDialog.locator('button[aria-label="Fermer la fenêtre"]');
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Fermer la fenêtre");
  assert(await closeButton.evaluate((button) => button === document.activeElement),
    "Opening a modal must move focus to its first focusable control.");
  const backgroundInactive = await page.evaluate(() =>
    Array.from(document.body.children)
      .filter((element) => !element.classList.contains("magnisa-modal-backdrop"))
      .every((element) => element.inert),
  );
  assert(backgroundInactive, "The page behind an open modal must be inert.");
  await page.keyboard.press("Escape");
  await regulatoryDialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-haspopup") === "dialog");
  await regulatoryRow.getByRole("button", { name: "Examiner" }).click();
  await regulatoryDialog.waitFor({ state: "visible" });
  await regulatoryDialog.locator('button[aria-label="Fermer la fenêtre"]').click();
  await regulatoryDialog.waitFor({ state: "hidden" });
  await regulatoryRow.getByRole("button", { name: "Examiner" }).click();
  await regulatoryDialog.waitFor({ state: "visible" });
  await regulatoryDialog.locator('textarea[name="review_note"]').fill("Trop court");
  await regulatoryDialog.getByRole("button", { name: "Valider le changement réglementaire" }).click();
  const regulatoryAlert = regulatoryDialog.getByRole("alert");
  await regulatoryAlert.waitFor({ state: "visible" });
  assert((await regulatoryAlert.innerText()).includes("au moins 20 caractères"),
    "A short regulatory justification must produce an accessible modal error.");
  assert(await regulatoryDialog.isVisible(), "Regulatory review modal must remain open after server validation failure.");
  assert(await regulatoryDialog.locator('textarea[name="review_note"]').inputValue() === "Trop court",
    "Regulatory review modal must preserve the submitted note after failure.");
  await regulatoryDialog.locator('textarea[name="review_note"]').fill("Justification réglementaire vérifiée par le responsable paie.");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/paie/veille-reglementaire" && url.searchParams.has("reviewed"), { timeout: 30000 }),
    regulatoryDialog.getByRole("button", { name: "Valider le changement réglementaire" }).click(),
  ]);
  const reviewedEvent = await admin.from("regulatory_watch_events")
    .select("review_status,review_note").eq("id", regulatoryEvent.id).single();
  if (reviewedEvent.error) throw reviewedEvent.error;
  assert(reviewedEvent.data.review_status === "validated", "Valid regulatory review was not persisted.");
  assert(reviewedEvent.data.review_note?.length >= 20, "Regulatory review justification was not persisted.");
  const regulatoryCleanup = await admin.from("regulatory_watch_events").delete().eq("id", regulatoryEvent.id);
  if (regulatoryCleanup.error) throw regulatoryCleanup.error;
  process.stdout.write("PASS UI: regulatory review modal preserves validation errors and persists a valid decision\\n");

  const latestValidatedRule = await admin.from("payroll_rule_sets").select("effective_from")
    .eq("organization_id", testOrganizationId).eq("status", "validated")
    .order("effective_from", { ascending: false }).limit(1).maybeSingle();
  if (latestValidatedRule.error) throw latestValidatedRule.error;
  assert(latestValidatedRule.data, "A validated payroll rule is required for the IRSA draft modal test.");
  const futureRuleDate = new Date(latestValidatedRule.data.effective_from + "T00:00:00.000Z");
  futureRuleDate.setUTCFullYear(futureRuleDate.getUTCFullYear() + 1);
  const futureRuleDateText = futureRuleDate.toISOString().slice(0, 10);
  await page.getByRole("button", { name: "Créer une version à vérifier" }).click();
  const healthDraftDialog = page.getByRole("dialog");
  await healthDraftDialog.waitFor({ state: "visible" });
  await healthDraftDialog.locator('input[name="rate_percent"]').fill("3");
  await healthDraftDialog.locator('input[name="effective_from"]').fill(futureRuleDateText);
  await healthDraftDialog.locator('input[name="legal_reference"]').fill("https://evil.example/regulatory-text");
  await healthDraftDialog.getByRole("button", { name: "Créer une version à vérifier" }).click();
  const healthDraftAlert = healthDraftDialog.getByRole("alert");
  await healthDraftAlert.waitFor({ state: "visible" });
  assert((await healthDraftAlert.innerText()).includes("domaine de la source officielle"),
    "An unapproved regulatory domain must be rejected inside the modal.");
  assert(await healthDraftDialog.isVisible(), "IRSA draft modal must remain open after validation failure.");
  assert(await healthDraftDialog.locator('input[name="legal_reference"]').inputValue() === "https://evil.example/regulatory-text",
    "IRSA draft modal must preserve the invalid URL for correction.");
  process.stdout.write("PASS UI: IRSA draft modal preserves server-side domain validation errors\\n");

  const existingFiscalYears = await admin.from("accounting_fiscal_years")
    .select("period_start,period_end").eq("organization_id", testOrganizationId);
  if (existingFiscalYears.error) throw existingFiscalYears.error;
  const earliestFiscalYear = existingFiscalYears.data
    .map((year) => Number(String(year.period_start).slice(0, 4)))
    .sort((a, b) => a - b)[0];
  const fiscalYearNumber = earliestFiscalYear ? earliestFiscalYear - 1 : 2000;
  const fiscalStart = String(fiscalYearNumber).padStart(4, "0") + "-01-01";
  const fiscalEnd = String(fiscalYearNumber).padStart(4, "0") + "-12-31";
  const fiscalLabel = "UI zero-opening " + Date.now();
  const fiscalResponse = await page.goto(`${baseUrl}/exercices-comptables`, { waitUntil: "domcontentloaded" });
  assert(fiscalResponse?.ok(), `Fiscal-year route returned ${fiscalResponse?.status()}`);
  await page.getByRole("heading", { name: "Exercices comptables" }).waitFor({ timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 });
  await page.getByRole("button", { name: "Créer un exercice" }).click();
  const fiscalDialog = page.getByRole("dialog");
  await fiscalDialog.waitFor({ state: "visible" });
  await fiscalDialog.locator('input[name="label"]').fill(fiscalLabel);
  await fiscalDialog.locator('input[name="period_start"]').fill(fiscalEnd);
  await fiscalDialog.locator('input[name="period_end"]').fill(fiscalStart);
  await fiscalDialog.getByRole("button", { name: "Créer l'exercice" }).click();
  const fiscalAlert = fiscalDialog.getByRole("alert");
  await fiscalAlert.waitFor({ state: "visible" });
  assert((await fiscalAlert.innerText()).includes("Exercice comptable invalide"),
    "An invalid fiscal period must be shown inside the modal instead of escaping as a server error.");
  assert(await fiscalDialog.locator('input[name="label"]').inputValue() === fiscalLabel,
    "Fiscal-year modal must preserve the label after server validation failure.");
  await fiscalDialog.locator('input[name="period_start"]').fill(fiscalStart);
  await fiscalDialog.locator('input[name="period_end"]').fill(fiscalEnd);
  await fiscalDialog.getByRole("button", { name: "Créer l'exercice" }).click();
  await fiscalDialog.waitFor({ state: "hidden", timeout: 30000 });
  const createdFiscalYear = await admin.from("accounting_fiscal_years")
    .select("id,status,opening_entry_id").eq("organization_id", testOrganizationId)
    .eq("label", fiscalLabel).single();
  if (createdFiscalYear.error) throw createdFiscalYear.error;
  assert(createdFiscalYear.data.status === "open", "A first fiscal year without opening balances must be created as open.");
  assert(createdFiscalYear.data.opening_entry_id === null,
    "A first fiscal year without opening balances must not create an artificial opening journal.");
  const fiscalRow = page.locator("tbody tr").filter({ hasText: fiscalLabel }).first();
  await fiscalRow.getByRole("button", { name: "Clôturer" }).click();
  const closeFiscalDialog = page.getByRole("dialog");
  await closeFiscalDialog.waitFor({ state: "visible" });
  await closeFiscalDialog.getByRole("button", { name: "Confirmer la clôture" }).click();
  await closeFiscalDialog.waitFor({ state: "hidden", timeout: 30000 });
  const closedFiscalYear = await admin.from("accounting_fiscal_years")
    .select("status,closed_at").eq("organization_id", testOrganizationId)
    .eq("id", createdFiscalYear.data.id).single();
  if (closedFiscalYear.error) throw closedFiscalYear.error;
  assert(closedFiscalYear.data.status === "closed" && closedFiscalYear.data.closed_at,
    "Fiscal-year closure modal must persist the server-confirmed closed state.");
  process.stdout.write("PASS UI: fiscal-year modal preserves errors, creates a zero-opening first year and confirms closure\\n");

  assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.join(" | ")}`);
  process.stdout.write("PASS UI: no uncaught browser page errors\n");
} finally {
  await browser.close();
}