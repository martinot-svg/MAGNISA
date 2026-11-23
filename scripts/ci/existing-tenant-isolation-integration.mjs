import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Isolated local Supabase credentials are required.");

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomUUID().slice(0, 10);
const users = [];
const organizations = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function createTenant(label) {
  const email = `tenant-parity-${label}-${suffix}@magnisa.test`;
  const password = randomBytes(24).toString("hex");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("Unable to create isolated tenant user");
  users.push(data.user.id);

  const { data: org, error: orgError } = await admin.from("organizations")
    .insert({ name: `QA existing tenant ${label} ${suffix}` }).select("id").single();
  if (orgError || !org) throw orgError ?? new Error("Tenant fixture creation failed");
  organizations.push(org.id);

  const { error: memberError } = await admin.from("organization_members")
    .insert({ organization_id: org.id, user_id: data.user.id, role: "owner", status: "active" });
  if (memberError) throw memberError;

  const { data: customer, error: customerError } = await admin.from("customers")
    .insert({ organization_id: org.id, name: `Persisted customer ${label} ${suffix}` })
    .select("id,name").single();
  if (customerError || !customer) throw customerError ?? new Error("Populated tenant fixture failed");

  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: loginError } = await client.auth.signInWithPassword({ email, password });
  if (loginError) throw loginError;
  return { client, orgId: org.id, customer };
}

try {
  const a = await createTenant("A");
  const b = await createTenant("B");

  const { data: visibleA, error: readAError } = await a.client.from("customers").select("id,name");
  if (readAError) throw readAError;
  assert(visibleA?.length === 1 && visibleA[0].id === a.customer.id,
    "Tenant A must see its persisted customer only; cross-tenant read isolation failed");

  const { data: visibleB, error: readBError } = await b.client.from("customers").select("id,name");
  if (readBError) throw readBError;
  assert(visibleB?.length === 1 && visibleB[0].id === b.customer.id,
    "Tenant B must see its persisted customer only; cross-tenant read isolation failed");

  const { error: crossInsertError } = await a.client.from("customers")
    .insert({ organization_id: b.orgId, name: `Forbidden cross-tenant write ${suffix}` });
  assert(Boolean(crossInsertError), "Tenant A unexpectedly inserted a customer into Tenant B");

  // RLS may reject UPDATE/DELETE by returning zero affected rows rather than an error.
  const { data: crossUpdate, error: crossUpdateError } = await a.client.from("customers")
    .update({ name: `Tampered by tenant A ${suffix}` }).eq("id", b.customer.id).select("id");
  if (crossUpdateError) throw crossUpdateError;
  assert(crossUpdate?.length === 0, "Tenant A unexpectedly updated Tenant B's customer");

  const { data: crossDelete, error: crossDeleteError } = await a.client.from("customers")
    .delete().eq("id", b.customer.id).select("id");
  if (crossDeleteError) throw crossDeleteError;
  assert(crossDelete?.length === 0, "Tenant A unexpectedly deleted Tenant B's customer");

  const { data: intactB, error: intactBError } = await b.client.from("customers").select("id,name");
  if (intactBError) throw intactBError;
  assert(intactB?.length === 1 && intactB[0].id === b.customer.id && intactB[0].name === b.customer.name,
    "Tenant B's persisted customer was changed or deleted by Tenant A");

  const { data: ownInsert, error: ownInsertError } = await a.client.from("customers")
    .insert({ organization_id: a.orgId, name: `Allowed own tenant write ${suffix}` }).select("id").single();
  if (ownInsertError || !ownInsert) throw ownInsertError ?? new Error("Own-tenant write was unexpectedly denied");

  const { data: afterA, error: afterAError } = await a.client.from("customers").select("id");
  if (afterAError) throw afterAError;
  assert(afterA?.length === 2 && afterA.some(row => row.id === ownInsert.id),
    "Tenant A did not retain its own isolated persisted rows");

  console.log("PASS TENANT ISOLATION: populated tenants, scoped reads, rejected cross-tenant insert/update/delete, preserved tenant B row, allowed own-tenant insert");
} finally {
  for (const orgId of organizations) {
    const { error } = await admin.from("organizations").delete().eq("id", orgId);
    if (error) console.error("Fixture organization cleanup failed:", error.message);
  }
  for (const userId of users) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error("Fixture auth cleanup failed:", error.message);
  }
}
