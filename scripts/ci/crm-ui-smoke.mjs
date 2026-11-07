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
const { data: authData, error: authError } = await admin.auth.signInWithPassword({ email, password });
if (authError || !authData.user) throw authError ?? new Error("Unable to authenticate CRM smoke user.");
const userId = authData.user.id;
const { data: membership, error: membershipError } = await admin.from("organization_members")
  .select("organization_id,role,status").eq("user_id", userId).eq("status", "active").single();
if (membershipError || !membership) throw membershipError ?? new Error("CRM smoke user has no active organization.");
if (membership.role !== "owner") throw new Error("CRM smoke user must be the isolated organization owner.");

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
  await page.getByRole("link", { name: "Configurer les interventions" }).click();
  await page.getByRole("heading", { name: "Types d'intervention" }).waitFor();
  assert(await page.locator("tbody tr").count() === 11, "The configurable intervention catalog must show 11 types.");
  await page.goto(`${baseUrl}/prospects`, { waitUntil: "domcontentloaded" });

  const prospectName = "CRM UI " + Date.now();
  await page.getByRole("button", { name: /Nouveau prospect/ }).click();
  await page.locator('input[name="name"]').fill(prospectName);
  await page.locator('input[name="source"]').fill("CI browser smoke");
  await page.locator('textarea[name="notes"]').fill("Prospect créé par le test d'interface isolé.");
  await page.getByRole("button", { name: "Créer le prospect" }).click();

  const prospect = await waitForRow(async () => admin.from("prospects")
    .select("id,converted_customer_id").eq("organization_id", membership.organization_id)
    .eq("name", prospectName).maybeSingle());
  const closeDialog = page.getByRole("button", { name: "Fermer le formulaire" });
  if (await closeDialog.count()) await closeDialog.click();

  await page.goto(`${baseUrl}/prospects/${prospect.id}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: prospectName }).waitFor();
  const contributionDescription = "Qualification CRM UI " + Date.now();
  await page.locator('select[name="contributor_user_id"]').first().selectOption(userId);
  await page.locator('select[name="intervention_type"]').first().selectOption("qualification");
  await page.locator('select[name="contribution_role"]').first().selectOption("qualifier");
  await page.locator('select[name="stage_status"]').first().selectOption("completed");
  await page.locator('textarea[name="description"]').first().fill(contributionDescription);
  await page.getByRole("button", { name: "Enregistrer l'intervention" }).click();

  const intervention = await waitForRow(async () => admin.from("prospect_interventions")
    .select("id,stage_status,validation_status").eq("organization_id", membership.organization_id)
    .eq("prospect_id", prospect.id).eq("description", contributionDescription).maybeSingle());
  assert(intervention.validation_status === "pending", "A newly declared contribution must remain pending.");
  assert(await page.getByRole("button", { name: "Valider" }).count() === 0,
    "The beneficiary must not be offered a self-validation control.");

  const contributionRow = page.locator("tr").filter({ hasText: contributionDescription });
  await contributionRow.locator('select[name="stage_status"]').selectOption("in_progress");
  await contributionRow.locator('input[name="reason"]').fill("Progression enregistrée par le collaborateur.");
  await contributionRow.getByRole("button", { name: "Mettre à jour" }).click();
  await contributionRow.getByText("En cours").waitFor();
  const statusHistory = await admin.from("prospect_intervention_history").select("id")
    .eq("organization_id", membership.organization_id).eq("intervention_id", intervention.id)
    .eq("action", "status_changed");
  if (statusHistory.error) throw statusHistory.error;
  assert(statusHistory.data.length === 1, "Stage transition history was not persisted.");
  process.stdout.write("PASS CRM UI: prospect creation, intervention, beneficiary guard and stage history\n");

  await page.goto(`${baseUrl}/prospects`, { waitUntil: "domcontentloaded" });
  const prospectRow = page.locator("tr").filter({ hasText: prospectName });
  await prospectRow.getByRole("button", { name: "Clôturer comme gagné" }).click();
  const converted = await waitForRow(async () => admin.from("prospects")
    .select("converted_customer_id").eq("organization_id", membership.organization_id)
    .eq("id", prospect.id).maybeSingle());
  assert(converted.converted_customer_id, "Prospect conversion did not create a customer.");

  await page.goto(`${baseUrl}/clients/${converted.converted_customer_id}/contributions`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Journal collaboratif/ }).waitFor();
  await page.getByText(contributionDescription).waitFor();

  const followUpDescription = "Suivi client CRM UI " + Date.now();
  await page.locator('select[name="contributor_user_id"]').first().selectOption(userId);
  await page.locator('select[name="intervention_type"]').first().selectOption("follow_up");
  await page.locator('select[name="contribution_role"]').first().selectOption("account_manager");
  await page.locator('select[name="stage_status"]').first().selectOption("completed");
  await page.locator('textarea[name="description"]').first().fill(followUpDescription);
  await page.getByRole("button", { name: "Enregistrer l'intervention" }).click();
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
