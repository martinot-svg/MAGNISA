import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerId = process.env.TEST_USER_ID;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!url || !anonKey || !serviceKey || !ownerId || !email || !password) {
  throw new Error("Missing isolated Supabase CRM integration-test environment.");
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const owner = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const signedIn = await owner.auth.signInWithPassword({ email, password });
if (signedIn.error || signedIn.data.user?.id !== ownerId) throw signedIn.error ?? new Error("CRM owner authentication mismatch.");

const membershipResult = await admin.from("organization_members")
  .select("organization_id").eq("user_id", ownerId).eq("status", "active").single();
if (membershipResult.error) throw membershipResult.error;
const organizationId = membershipResult.data.organization_id;

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rpc = async (client, name, args) => {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(name + ": " + result.error.message);
  return result.data;
};
const expectRpcDenied = async (client, name, args, message) => {
  const result = await client.rpc(name, args);
  assert(!!result.error, message);
};

const suffix = Date.now();
const collaboratorEmail = `crm-contributor-${suffix}@magnisa.test`;
const collaboratorCreated = await admin.auth.admin.createUser({
  email: collaboratorEmail,
  password: `CRM-Integration-${suffix}!Aa9`,
  email_confirm: true,
  user_metadata: { full_name: "MAGNISA CRM Integration Contributor" },
});
if (collaboratorCreated.error || !collaboratorCreated.data.user) {
  throw collaboratorCreated.error ?? new Error("Could not create isolated CRM collaborator.");
}
const collaboratorId = collaboratorCreated.data.user.id;
const memberInsert = await admin.from("organization_members").insert({
  organization_id: organizationId, user_id: collaboratorId, role: "owner", status: "active", department: "Commercial",
});
if (memberInsert.error) throw memberInsert.error;

const collaborator = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const collaboratorAuth = await collaborator.auth.signInWithPassword({
  email: collaboratorEmail, password: `CRM-Integration-${suffix}!Aa9`,
});
if (collaboratorAuth.error) throw collaboratorAuth.error;

const prospectId = await rpc(owner, "create_prospect_with_originator", {
  p_org: organizationId, p_name: `CRM Commission Integration ${suffix}`,
  p_email: null, p_phone: null, p_source: "Automated integration test", p_notes: "Disposable test fixture",
});

const record = async (type, role, description, contributor = collaboratorId, responsible = null, status = "completed") =>
  rpc(owner, "record_prospect_intervention", {
    p_org: organizationId, p_prospect: prospectId, p_customer: null,
    p_contributor: contributor, p_department: null, p_type: type, p_role: role,
    p_stage_status: status, p_description: description, p_evidence: null,
    p_responsible: responsible, p_occurred_at: null,
  });

const qualifierId = await record("qualification", "qualifier", "Verified qualification contribution");
const negotiatorId = await record("negotiation", "negotiator", "Verified negotiation contribution");
const closerId = await record("closing", "closer", "Verified closing contribution");
const rejectedId = await record("follow_up", "support", "Unaccepted follow-up contribution", collaboratorId, null, "in_progress");

const pendingBeforeReview = await admin.from("prospect_contributors").select("id,contribution_type")
  .eq("organization_id", organizationId).eq("prospect_id", prospectId);
if (pendingBeforeReview.error) throw pendingBeforeReview.error;
assert(pendingBeforeReview.data.length === 1 && pendingBeforeReview.data[0].contribution_type === "originator",
  "Pending interventions must not enter commission contributors.");

await expectRpcDenied(collaborator, "review_prospect_intervention", {
  p_org: organizationId, p_intervention: rejectedId, p_decision: "validate", p_reason: "Self-review must be blocked",
}, "A contributor must not validate their own intervention.");

await rpc(owner, "change_prospect_intervention_status", {
  p_org: organizationId, p_intervention: rejectedId, p_stage_status: "blocked",
  p_reason: "Stage transition recorded by an authorized manager",
});
const history = await admin.from("prospect_intervention_history").select("id")
  .eq("organization_id", organizationId).eq("intervention_id", rejectedId).eq("action", "status_changed");
if (history.error) throw history.error;
assert(history.data.length === 1, "Stage changes must append an immutable history record.");

await rpc(owner, "review_prospect_intervention", {
  p_org: organizationId, p_intervention: qualifierId, p_decision: "validate", p_reason: "Qualification evidence checked",
});
await rpc(owner, "review_prospect_intervention", {
  p_org: organizationId, p_intervention: negotiatorId, p_decision: "validate", p_reason: "Negotiation evidence checked",
});
await rpc(owner, "review_prospect_intervention", {
  p_org: organizationId, p_intervention: closerId, p_decision: "validate", p_reason: "Closing evidence checked",
});
await rpc(owner, "review_prospect_intervention", {
  p_org: organizationId, p_intervention: rejectedId, p_decision: "reject", p_reason: "Insufficient supporting evidence",
});

const transferId = await record("transfer", "support", "Responsibility transferred to collaborator", ownerId, collaboratorId, "transferred");
const transferRow = await admin.from("prospects").select("current_owner_id").eq("organization_id", organizationId).eq("id", prospectId).single();
if (transferRow.error) throw transferRow.error;
assert(transferRow.data.current_owner_id === collaboratorId, "Transfer must update the current owner.");
const transferContribution = await admin.from("prospect_contributors").select("id")
  .eq("organization_id", organizationId).eq("prospect_id", prospectId).eq("user_id", collaboratorId).eq("contribution_type", "support");
if (transferContribution.error) throw transferContribution.error;
assert(transferContribution.data.length === 0, "A transfer must never create a commission contributor.");

const contributors = await admin.from("prospect_contributors").select("user_id,contribution_type")
  .eq("organization_id", organizationId).eq("prospect_id", prospectId);
if (contributors.error) throw contributors.error;
assert(contributors.data.length === 4, "Only the initiator and three independently validated contributions should be commissionable.");

const policy = await admin.from("commission_policies").insert({
  organization_id: organizationId, name: `CRM Integration Policy ${suffix}`, description: "Disposable CI policy",
  is_active: true, effective_from: new Date().toISOString().slice(0, 10), calculation_basis: "fixed_amount",
  tax_basis: "net", commission_rate: 10, fixed_basis_amount: 100000, currency: "MGA",
  expense_account_code: "622", created_by: ownerId, updated_by: ownerId,
}).select("id").single();
if (policy.error) throw policy.error;
const rules = await admin.from("commission_policy_rules").insert([
  { organization_id: organizationId, policy_id: policy.data.id, contribution_type: "originator", share_percentage: 40 },
  { organization_id: organizationId, policy_id: policy.data.id, contribution_type: "qualifier", share_percentage: 30 },
  { organization_id: organizationId, policy_id: policy.data.id, contribution_type: "negotiator", share_percentage: 20 },
  { organization_id: organizationId, policy_id: policy.data.id, contribution_type: "closer", share_percentage: 10 },
]);
if (rules.error) throw rules.error;

const customerId = await rpc(owner, "convert_prospect_to_customer", { p_org: organizationId, p_prospect: prospectId });
assert(!!customerId, "Conversion must create a linked customer.");

const orderNumber = `CRM-ORDER-${suffix}`;
const order = await admin.from("orders").insert({
  organization_id: organizationId, customer_id: customerId, number: orderNumber,
  status: "confirmed", subtotal: 100000, tax_total: 0, total: 100000, created_by: ownerId,
}).select("id").single();
if (order.error) throw order.error;
const invoiceNumber = `CRM-INVOICE-${suffix}`;
const invoice = await admin.from("invoices").insert({
  organization_id: organizationId, customer_id: customerId, number: invoiceNumber,
  status: "paid", subtotal: 100000, discount_total: 0, tax_total: 0,
  total: 100000, paid_amount: 100000, balance_due: 0, created_by: ownerId,
}).select("id").single();
if (invoice.error) throw invoice.error;

const automaticEvents = await admin.from("prospect_interventions")
  .select("id,intervention_type,contribution_role,validation_status,evidence_reference")
  .eq("organization_id", organizationId).eq("customer_id", customerId)
  .in("evidence_reference", [`order:${order.data.id}`, `invoice:${invoice.data.id}`]);
if (automaticEvents.error) throw automaticEvents.error;
assert(automaticEvents.data.length === 2, "Confirmed order and paid invoice must each create one CRM event.");
assert(automaticEvents.data.every(event => event.validation_status === "pending" && event.contribution_role === "support"),
  "Financial source events must remain pending support events and cannot earn commission automatically.");
await admin.from("orders").update({ notes: "Idempotency update" }).eq("id", order.data.id);
await admin.from("invoices").update({ notes: "Idempotency update" }).eq("id", invoice.data.id);
const eventCounts = await admin.from("prospect_interventions").select("id", { count: "exact", head: true })
  .eq("organization_id", organizationId).eq("customer_id", customerId)
  .in("evidence_reference", [`order:${order.data.id}`, `invoice:${invoice.data.id}`]);
assert(eventCounts.count === 2, "CRM event updates must not create duplicate intervention rows.");

const requestKey = crypto.randomUUID();
const calculationId = await rpc(owner, "calculate_prospect_commission", {
  p_org: organizationId, p_prospect: prospectId, p_policy: policy.data.id,
  p_source_document_type: null, p_source_document_id: null, p_request_key: requestKey,
});
const repeatedCalculationId = await rpc(owner, "calculate_prospect_commission", {
  p_org: organizationId, p_prospect: prospectId, p_policy: policy.data.id,
  p_source_document_type: null, p_source_document_id: null, p_request_key: requestKey,
});
assert(calculationId === repeatedCalculationId, "Commission calculation must be idempotent for the same request key.");

const allocationResult = await admin.from("commission_allocations")
  .select("user_id,contribution_type,share_percentage,amount")
  .eq("organization_id", organizationId).eq("calculation_id", calculationId);
if (allocationResult.error) throw allocationResult.error;
const allocations = allocationResult.data;
const total = allocations.reduce((sum, item) => sum + Number(item.amount), 0);
const byRole = Object.fromEntries(allocations.map(item => [item.contribution_type, Number(item.amount)]));
assert(allocations.length === 4, "Commission engine must allocate one share for each validated contribution role.");
assert(Math.abs(total - 10000) < 0.001, `Commission allocations must sum to 10,000 MGA; got ${total}.`);
assert(byRole.originator === 4000 && byRole.qualifier === 3000 && byRole.negotiator === 2000 && byRole.closer === 1000,
  "Commission amounts must respect the 40/30/20/10 policy shares.");
assert(!allocations.some(item => item.contribution_type === "support"), "Transfer and support events must not receive commission.");

const secondOrg = await admin.from("organizations").insert({ name: `CRM Isolation ${suffix}`, currency: "MGA" }).select("id").single();
if (secondOrg.error) throw secondOrg.error;
const secondMembership = await admin.from("organization_members").insert({
  organization_id: secondOrg.data.id, user_id: collaboratorId, role: "owner", status: "active", department: "Other tenant",
});
if (secondMembership.error) throw secondMembership.error;
const secondProspect = await rpc(collaborator, "create_prospect_with_originator", {
  p_org: secondOrg.data.id, p_name: `Other tenant prospect ${suffix}`,
  p_email: null, p_phone: null, p_source: "Isolation test", p_notes: null,
});
await expectRpcDenied(owner, "record_prospect_intervention", {
  p_org: secondOrg.data.id, p_prospect: secondProspect, p_customer: null,
  p_contributor: ownerId, p_department: null, p_type: "qualification", p_role: "qualifier",
  p_stage_status: "completed", p_description: "Cross-tenant write must be denied",
  p_evidence: null, p_responsible: null, p_occurred_at: null,
}, "A user must not create contributions in an organization where they are not a member.");

process.stdout.write("PASS CRM integration: multiple validated contributors, rejected/self-review guard, stage history and transfer audit\n");
process.stdout.write("PASS CRM integration: transfer/support events do not enter commission allocations\n");
process.stdout.write("PASS CRM integration: commission shares 40/30/20/10 reconcile to 10,000 MGA; idempotency verified\n");
process.stdout.write("PASS CRM integration: cross-organization write denied\n");
