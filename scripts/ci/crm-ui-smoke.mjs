import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!url || !serviceKey || !anonKey || !email || !password) {
  throw new Error("Missing isolated local Supabase CRM smoke-test environment.");
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const userClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: authData, error: authError } = await userClient.auth.signInWithPassword({ email, password });
if (authError || !authData.user) throw authError ?? new Error("Unable to authenticate CRM smoke user.");
const userId = authData.user.id;
const { data: membership, error: membershipError } = await admin.from("organization_members")
  .select("organization_id,role,status").eq("user_id", userId).eq("status", "active").single();
if (membershipError || !membership) throw membershipError ?? new Error("CRM smoke user has no active organization.");
if (membership.role !== "owner") throw new Error("CRM smoke user must be the isolated organization owner.");
const collaboratorEmail = "crm-ui-contributor@" + Date.now() + ".magnisa.test";
const collaboratorPassword = "CRM-UI-Test-2026!Aa9";
const { data: collaboratorCreated, error: collaboratorError } = await admin.auth.admin.createUser({
  email: collaboratorEmail, password: collaboratorPassword, email_confirm: true,
  user_metadata: { full_name: "MAGNISA CRM UI Contributor" },
});
if (collaboratorError || !collaboratorCreated.user) throw collaboratorError ?? new Error("Could not create CRM UI contributor.");
const collaboratorId = collaboratorCreated.user.id;
const collaboratorMembership = await admin.from("organization_members").insert({
  organization_id: membership.organization_id, user_id: collaboratorId,
  role: "owner", status: "active", department: "Commercial",
});
if (collaboratorMembership.error) throw collaboratorMembership.error;

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const waitForRow = async (query, attempts = 20) => {
  for (let i = 0; i < attempts; i++) {
    const result = await query();
    if (!result.error && result.data) return result.data;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for a CRM database write.");
};

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((target) => target.pathname === "/dashboard", { timeout: 30000 });

  await page.goto(`${baseUrl}/prospects`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Prospects" }).waitFor();
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.getByRole("link", { name: "Configurer les interventions" }).click();
  await page.getByRole("heading", { name: "Types d'intervention" }).waitFor();
  // The editable catalog is intentionally inside the shared FormDialog.
  await page.getByRole("button", { name: "Enregistrer la configuration" }).click();
  const interventionDialog = page.getByRole("dialog");
  await interventionDialog.waitFor({ state: "visible", timeout: 10000 });
  assert(await interventionDialog.locator("tbody tr").count() === 11, "The configurable intervention catalog must show 11 types.");
  await interventionDialog.locator('button[aria-label="Fermer la fenêtre"]').click();
  await interventionDialog.waitFor({ state: "hidden" });
  await page.goto(`${baseUrl}/prospects`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Prospects" }).waitFor();
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const prospectName = "CRM UI " + Date.now();
  const createProspectButton = page.getByRole("button", { name: "+ Nouveau prospect" });
  await createProspectButton.click();
  const prospectDialog = page.getByRole("dialog", { name: "Nouveau prospect" });
  await prospectDialog.waitFor({ state: "visible", timeout: 10000 });

  const modalState = await page.evaluate(() => {
    const layer = document.querySelector(".magnisa-modal-backdrop");
    const dialog = document.querySelector('[role="dialog"]');
    const background = Array.from(document.body.children).filter((element) => element !== layer);
    return {
      bodyOverflow: document.body.style.overflow,
      backgroundInert: background.every((element) => element.inert),
      backgroundHidden: background.every((element) => element.getAttribute("aria-hidden") === "true"),
      focusInside: !!dialog && dialog.contains(document.activeElement),
      backdropFilter: layer ? getComputedStyle(layer).backdropFilter : "",
    };
  });
  assert(modalState.bodyOverflow === "hidden", "Modal must lock background scrolling.");
  assert(modalState.backgroundInert && modalState.backgroundHidden, "Modal must make background content inert.");
  assert(modalState.focusInside, "Modal must move focus into the dialog.");
  assert(modalState.backdropFilter.includes("blur"), "Modal backdrop must apply a blur.");

  await page.mouse.click(4, 4);
  assert(await prospectDialog.isVisible(), "Backdrop click must not discard the open form.");
  const modalFocusable = prospectDialog.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  assert(await modalFocusable.count() > 1, "Modal must expose keyboard-focusable controls.");
  await modalFocusable.first().focus();
  await page.keyboard.press("Shift+Tab");
  assert(await modalFocusable.last().evaluate((element) => element === document.activeElement), "Shift+Tab must wrap focus to the last modal control.");
  await page.keyboard.press("Tab");
  assert(await modalFocusable.first().evaluate((element) => element === document.activeElement), "Tab must wrap focus to the first modal control.");

  await page.keyboard.press("Escape");
  await prospectDialog.waitFor({ state: "hidden" });
  assert(await createProspectButton.getAttribute("aria-expanded") === "false", "Escape must close the dialog and reset its trigger.");
  await createProspectButton.click();
  await prospectDialog.waitFor({ state: "visible" });

  const prospectForm = prospectDialog.locator("form");
  const prospectNameInput = prospectDialog.locator('input[name="name"]');
  await prospectForm.evaluate((element) => { element.noValidate = true; });
  await prospectNameInput.fill("X");
  await prospectDialog.getByRole("button", { name: "Créer le prospect" }).click();
  await prospectDialog.getByRole("alert").waitFor({ state: "visible" });
  assert(await prospectDialog.isVisible(), "A rejected server action must keep the modal open.");
  await page.waitForFunction(() => document.querySelector('input[name="name"]')?.value === "X");
  assert(await prospectNameInput.inputValue() === "X", "A rejected server action must preserve entered values.");

  await prospectNameInput.fill(prospectName);
  await prospectDialog.locator('input[name="source"]').fill("CI browser smoke");
  await prospectDialog.locator('textarea[name="notes"]').fill("Prospect créé par le test d'interface isolé.");
  await prospectDialog.getByRole("button", { name: "Créer le prospect" }).click();
  await prospectDialog.waitFor({ state: "hidden" });
  await page.getByRole("status").filter({ hasText: "Opération enregistrée." }).waitFor();

  const prospect = await waitForRow(async () => admin.from("prospects")
    .select("id,converted_customer_id").eq("organization_id", membership.organization_id)
    .eq("name", prospectName).maybeSingle());
  const closeDialog = page.getByRole("button", { name: "Fermer le formulaire" });
  if (await closeDialog.count()) await closeDialog.click();

  await page.goto(`${baseUrl}/prospects/${prospect.id}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: prospectName }).waitFor();
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const contributionDescription = "Qualification CRM UI " + Date.now();
  await page.getByRole("button", { name: /Enregistrer l.intervention/ }).first().click();
  const contributionDialog = page.getByRole("dialog").last();
  await contributionDialog.waitFor({ state: "visible", timeout: 10000 });
  const contributionForm = contributionDialog.locator("form").first();
  await contributionForm.locator('select[name="contributor_user_id"]').selectOption(collaboratorId);
  await contributionForm.locator('select[name="intervention_type"]').selectOption("qualification");
  await contributionForm.locator('select[name="contribution_role"]').selectOption("qualifier");
  const initialStage = contributionForm.locator('select[name="stage_status"]');
  await initialStage.selectOption("completed");
  assert(await initialStage.inputValue() === "completed", "The UI must submit the explicitly selected initial intervention stage.");
  await contributionForm.locator('textarea[name="description"]').fill(contributionDescription);
  await contributionForm.getByRole("button", { name: /Enregistrer l.intervention/ }).click();
  await contributionDialog.waitFor({ state: "hidden", timeout: 20000 });

  const intervention = await waitForRow(async () => admin.from("prospect_interventions")
    .select("id,stage_status,validation_status,contributor_user_id,created_by").eq("organization_id", membership.organization_id)
    .eq("prospect_id", prospect.id).eq("description", contributionDescription).maybeSingle());
  assert(intervention.stage_status === "completed", "The selected initial intervention stage was not persisted.");
  assert(intervention.validation_status === "pending", "A newly declared contribution must remain pending.");
  assert(intervention.contributor_user_id === collaboratorId && intervention.created_by === userId,
    "A delegated contribution must preserve contributor identity separately from its author.");
  await page.getByText(contributionDescription).waitFor({ state: "visible", timeout: 10000 });
  const pendingRow = page.locator("tr").filter({ hasText: contributionDescription });
  await pendingRow.getByRole("button", { name: "Ouvrir la décision" }).click();
  const validationDialog = page.getByRole("dialog").last();
  await validationDialog.waitFor({ state: "visible", timeout: 10000 });
  const validationForm = validationDialog.locator("form");
  await validationForm.getByRole("button", { name: "Valider" }).waitFor({ state: "visible", timeout: 10000 });
  assert(await validationForm.getByRole("button", { name: "Valider" }).count() === 1,
    "An independent owner must be offered validation for another contributor.");
  await validationForm.locator('input[name="reason"]').fill("Justificatif et identité du contributeur contrôlés indépendamment.");
  await validationForm.getByRole("button", { name: "Valider" }).click();
  await validationDialog.waitFor({ state: "hidden", timeout: 20000 });
  await pendingRow.getByText("Validée").waitFor();
  const validatedContributor = await admin.from("prospect_contributors").select("id")
    .eq("organization_id", membership.organization_id).eq("prospect_id", prospect.id)
    .eq("user_id", collaboratorId).eq("contribution_type", "qualifier");
  if (validatedContributor.error) throw validatedContributor.error;
  assert(validatedContributor.data.length === 1, "Independent validation must register the eligible commission contributor.");

  const contributionRow = page.locator("tr").filter({ hasText: contributionDescription });
  await contributionRow.getByRole("button", { name: "Modifier le statut" }).click();
  const statusDialog = page.getByRole("dialog").last();
  await statusDialog.waitFor({ state: "visible", timeout: 10000 });
  const statusForm = statusDialog.locator("form");
  await statusForm.locator('select[name="stage_status"]').selectOption("in_progress");
  await statusForm.locator('input[name="reason"]').fill("Progression enregistrée par le collaborateur.");
  await statusForm.getByRole("button", { name: "Mettre à jour" }).click();
  await statusDialog.waitFor({ state: "hidden", timeout: 20000 });
  const persistedStage = await waitForRow(async () => {
    const result = await admin.from("prospect_interventions")
      .select("stage_status").eq("organization_id", membership.organization_id)
      .eq("id", intervention.id).maybeSingle();
    return result.data?.stage_status === "in_progress" ? result : { ...result, data: null };
  });
  assert(persistedStage.stage_status === "in_progress", "The intervention stage update was not persisted in Supabase.");
  const statusHistory = await waitForRow(async () => admin.from("prospect_intervention_history").select("id")
    .eq("organization_id", membership.organization_id).eq("intervention_id", intervention.id)
    .eq("action", "status_changed").maybeSingle());
  assert(!!statusHistory.id, "Stage transition history was not persisted.");
  await page.reload({ waitUntil: "domcontentloaded" });
  const refreshedContributionRow = page.locator("tr").filter({ hasText: contributionDescription }).first();
  await refreshedContributionRow.waitFor({ state: "visible", timeout: 10000 });
  assert((await refreshedContributionRow.innerText()).includes("En cours"),
    "The intervention stage was not retained in the timeline after a full page reload.");
  process.stdout.write("PASS CRM UI: prospect creation, intervention, beneficiary guard and stage history\n");

  await page.goto(`${baseUrl}/prospects`, { waitUntil: "domcontentloaded" });
  const prospectRow = page.locator("tr").filter({ hasText: prospectName });
  await prospectRow.getByRole("button", { name: "Clôturer comme gagné" }).click();
  let converted = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await admin.from("prospects").select("converted_customer_id")
      .eq("organization_id", membership.organization_id).eq("id", prospect.id).maybeSingle();
    if (result.error) throw result.error;
    if (result.data?.converted_customer_id) { converted = result.data; break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(converted?.converted_customer_id, "Prospect conversion did not create a customer.");

  await page.goto(`${baseUrl}/clients/${converted.converted_customer_id}/contributions`, { waitUntil: "domcontentloaded" });
  await page.getByText("Client · Journal collaboratif").waitFor();
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.getByText(contributionDescription).waitFor();

  const followUpDescription = "Suivi client CRM UI " + Date.now();
  await page.getByRole("button", { name: /Enregistrer l.intervention/ }).first().click();
  const followUpDialog = page.getByRole("dialog").last();
  await followUpDialog.waitFor({ state: "visible", timeout: 10000 });
  const followUpForm = followUpDialog.locator("form");
  await followUpForm.locator('select[name="contributor_user_id"]').selectOption(collaboratorId);
  await followUpForm.locator('select[name="intervention_type"]').selectOption("follow_up");
  await followUpForm.locator('select[name="contribution_role"]').selectOption("account_manager");
  await followUpForm.locator('select[name="stage_status"]').selectOption("completed");
  await followUpForm.locator('textarea[name="description"]').fill(followUpDescription);
  await followUpForm.getByRole("button", { name: /Enregistrer l.intervention/ }).click();
  await followUpDialog.waitFor({ state: "hidden", timeout: 20000 });
  await page.getByText(followUpDescription).waitFor();
  const followUp = await waitForRow(async () => admin.from("prospect_interventions")
    .select("id,customer_id").eq("organization_id", membership.organization_id)
    .eq("customer_id", converted.converted_customer_id).eq("description", followUpDescription).maybeSingle());
  assert(followUp.customer_id === converted.converted_customer_id, "Client follow-up was not attached to the converted customer.");

  assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.join(" | ")}`);
  process.stdout.write("PASS CRM UI: conversion, full inherited prospect timeline and client follow-up\n");
  process.stdout.write("PASS CRM UI: no uncaught browser page errors\n");
} finally {
  await browser.close();
}
