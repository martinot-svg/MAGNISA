import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!url || !anonKey || !serviceKey || !email || !password) {
  throw new Error("Missing isolated local Supabase credentials for stock browser test.");
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const userClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: auth, error: authError } = await userClient.auth.signInWithPassword({ email, password });
if (authError || !auth.user) throw authError ?? new Error("Stock browser test user authentication failed.");

const orgId = "e1000000-0000-4000-8000-000000000001";
const itemId = "e1000000-0000-4000-8000-000000000132";
const locationId = "e1000000-0000-4000-8000-000000000133";
const orderIds = [
  "e1000000-0000-4000-8000-000000000134",
  "e1000000-0000-4000-8000-000000000135",
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const waitFor = async (query, description, attempts = 30) => {
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await query();
    if (error) throw error;
    if (data) return data;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for " + description + ".");
};

const { data: reservations, error: reservationError } = await admin.from("stock_reservations")
  .select("id,order_id").eq("organization_id", orgId).eq("item_id", itemId)
  .in("order_id", orderIds).in("status", ["active", "partially_fulfilled"]);
if (reservationError) throw reservationError;
assert(reservations.length === 1, "Concurrency precondition must leave exactly one order reserved.");
const freeOrderId = orderIds.find((id) => !reservations.some((reservation) => reservation.order_id === id));
assert(freeOrderId, "Could not identify the order left unreserved by the concurrency race.");
const { data: orderLine, error: lineError } = await admin.from("order_lines")
  .select("id").eq("organization_id", orgId).eq("order_id", freeOrderId).eq("item_id", itemId).single();
if (lineError) throw lineError;

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

  await page.goto(`${baseUrl}/commandes`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Commandes" }).waitFor();
  const orderNumber = freeOrderId.endsWith("134") ? "CI-RACE-ORDER-A" : "CI-RACE-ORDER-B";
  let orderRow = page.locator("tr").filter({ hasText: orderNumber });
  await orderRow.waitFor({ state: "visible" });
  let stockDetails = orderRow.locator("details").filter({ hasText: "Stock & livraisons" });
  await stockDetails.locator("summary").click();
  // Reservation and delivery forms are opened by FormDialog triggers; the
  // inputs only exist inside the dialog after the trigger is activated.
  await stockDetails.getByRole("button", { name: "Réserver" }).first().click();
  const reserveDialog = page.getByRole("dialog").last();
  await reserveDialog.waitFor({ state: "visible", timeout: 10000 });
  const reserveForm = reserveDialog.locator("form");
  await reserveForm.locator('select[name="stock_location_id"]').selectOption(locationId);
  await reserveForm.locator('input[name="quantity"]').fill("1");
  await reserveForm.getByRole("button", { name: "Réserver" }).click();
  await reserveDialog.waitFor({ state: "hidden", timeout: 20000 });

  const newReservation = await waitFor(() => admin.from("stock_reservations")
    .select("id,quantity_reserved,status").eq("organization_id", orgId)
    .eq("order_id", freeOrderId).eq("order_line_id", orderLine.id)
    .eq("quantity_reserved", 1).maybeSingle(), "persisted reservation");
  assert(Number(newReservation.quantity_reserved) === 1, "UI reservation quantity was not persisted.");

  await page.getByRole("heading", { name: "Commandes" }).waitFor();
  await page.locator(`select[name="reservation_id"] option[value="${newReservation.id}"]`)
    .waitFor({ state: "attached", timeout: 10000 });
  orderRow = page.locator("tr").filter({ hasText: orderNumber });
  stockDetails = orderRow.locator("details").filter({ hasText: "Stock & livraisons" });
  if (!(await stockDetails.evaluate((element) => element.open))) {
    await stockDetails.locator("summary").click();
  }
  await stockDetails.getByRole("button", { name: "Enregistrer livraison" }).first().click();
  const deliveryDialog = page.getByRole("dialog").last();
  await deliveryDialog.waitFor({ state: "visible", timeout: 10000 });
  const deliveryForm = deliveryDialog.locator("form");
  await deliveryForm.locator('select[name="stock_location_id"]').selectOption(locationId);
  await deliveryForm.locator('select[name="reservation_id"]').selectOption(newReservation.id);
  await deliveryForm.locator('input[name="quantity"]').fill("1");
  await deliveryForm.locator('input[name="delivery_reference"]').fill("CI-BROWSER-DELIVERY-01");
  await deliveryForm.getByRole("button", { name: "Enregistrer livraison" }).click();
  await deliveryDialog.waitFor({ state: "hidden", timeout: 20000 });

  const delivery = await waitFor(() => admin.from("sales_deliveries")
    .select("id,status").eq("organization_id", orgId).eq("order_id", freeOrderId)
    .eq("delivery_reference", "CI-BROWSER-DELIVERY-01").maybeSingle(), "persisted customer delivery");
  const { data: deliveryLine, error: deliveryLineError } = await admin.from("sales_delivery_lines")
    .select("quantity_delivered").eq("organization_id", orgId).eq("delivery_id", delivery.id).single();
  if (deliveryLineError) throw deliveryLineError;
  assert(Number(deliveryLine.quantity_delivered) === 1, "UI delivery quantity was not persisted.");
  const { data: issue, error: issueError } = await admin.from("stock_movements")
    .select("quantity_delta").eq("organization_id", orgId).eq("source_type", "sales_delivery")
    .eq("source_id", delivery.id).single();
  if (issueError) throw issueError;
  assert(Number(issue.quantity_delta) === -1, "UI delivery did not create exactly one physical stock issue.");

  await page.goto(`${baseUrl}/mouvements-stock`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Mouvements & disponibilités" }).waitFor();
  await page.getByText("Quantités par emplacement").waitFor();
  assert(pageErrors.length === 0, "Browser runtime errors: " + pageErrors.join(" | "));
  process.stdout.write("PASS browser stock workflow: authenticated order screen -> persisted reservation -> persisted partial delivery -> append-only stock issue -> stock ledger screen\n");
} finally {
  await browser.close();
}
