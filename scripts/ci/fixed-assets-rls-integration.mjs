import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.TEST_USER_ID;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;

if (!url || !anonKey || !serviceKey || !userId || !email || !password) {
  throw new Error("Missing isolated fixed-asset RLS integration-test environment.");
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const owner = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const signedIn = await owner.auth.signInWithPassword({ email, password });
if (signedIn.error || signedIn.data.user?.id !== userId) {
  throw signedIn.error ?? new Error("Fixed-asset RLS owner authentication mismatch.");
}

const membership = await admin.from("organization_members")
  .select("organization_id").eq("user_id", userId).eq("status", "active").single();
if (membership.error) throw membership.error;
const organizationId = membership.data.organization_id;
const suffix = crypto.randomUUID();
const testAsset = await admin.from("fixed_assets").insert({
  organization_id: organizationId,
  asset_code: `CI-RLS-${suffix.slice(0, 8)}`,
  name: "CI fixed-asset RLS fixture",
  category: "equipment",
  acquisition_date: "2026-01-01",
  in_service_date: "2026-01-01",
  acquisition_cost: 120000,
  directly_attributable_cost: 0,
  residual_value: 0,
  useful_life_months: 24,
  depreciation_method: "straight_line",
  pcg_asset_account_code: "215",
  pcg_accumulated_depreciation_account_code: "281",
  pcg_depreciation_expense_account_code: "681",
  accumulated_depreciation: 0,
  impairment_loss: 0,
  net_book_value: 120000,
  status: "active",
}).select("id").single();
if (testAsset.error) throw testAsset.error;

const ownerAssets = await owner.from("fixed_assets").select("id")
  .eq("organization_id", organizationId).limit(10);
if (ownerAssets.error) throw ownerAssets.error;
if (ownerAssets.data.length === 0) {
  throw new Error("An owner with accounting.view must be able to read the fixed-asset register.");
}

const ownerReconciliation = await owner.from("fixed_asset_register_reconciliation")
  .select("account_code").eq("organization_id", organizationId).limit(10);
if (ownerReconciliation.error) throw ownerReconciliation.error;
if (ownerReconciliation.data.length === 0) {
  throw new Error("An owner with accounting.view must be able to read the fixed-asset reconciliation view.");
}

const viewerEmail = `fixed-asset-viewer-${suffix}@magnisa.test`;
// Supabase Auth enforces a 72-byte password ceiling. Use a high-entropy,
// fixed-length credential instead of concatenating multiple UUIDs.
const viewerPassword = `Vw-${crypto.randomBytes(16).toString("hex")}!a9`;
const created = await admin.auth.admin.createUser({
  email: viewerEmail,
  password: viewerPassword,
  email_confirm: true,
  user_metadata: { full_name: "MAGNISA Fixed Asset Read Isolation User" },
});
if (created.error || !created.data.user) {
  throw created.error ?? new Error("Could not create isolated fixed-asset viewer.");
}
const viewerId = created.data.user.id;
const viewerMembership = await admin.from("organization_members").insert({
  organization_id: organizationId,
  user_id: viewerId,
  role: "employee",
  status: "active",
});
if (viewerMembership.error) throw viewerMembership.error;

const viewer = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const viewerAuth = await viewer.auth.signInWithPassword({ email: viewerEmail, password: viewerPassword });
if (viewerAuth.error) throw viewerAuth.error;

const assertDenied = (result, label) => {
  if (result.error) {
    if (result.error.code !== "42501") throw new Error(`${label}: unexpected error ${result.error.code}`);
    return;
  }
  if (result.data.length !== 0) throw new Error(`${label}: user without accounting.view can read financial data`);
};

assertDenied(
  await viewer.from("fixed_assets").select("id").eq("organization_id", organizationId).limit(10),
  "Employee fixed_assets SELECT",
);
assertDenied(
  await viewer.from("fixed_asset_register_reconciliation").select("account_code")
    .eq("organization_id", organizationId).limit(10),
  "Employee fixed_asset_register_reconciliation SELECT",
);

const anonymous = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
assertDenied(
  await anonymous.from("fixed_assets").select("id").eq("organization_id", organizationId).limit(10),
  "Anonymous fixed_assets SELECT",
);
assertDenied(
  await anonymous.from("fixed_asset_register_reconciliation").select("account_code")
    .eq("organization_id", organizationId).limit(10),
  "Anonymous fixed_asset_register_reconciliation SELECT",
);

process.stdout.write("PASS fixed-asset RLS: accounting.view allowed; employee and anonymous reads denied; reconciliation view respects invoker RLS\\n");
