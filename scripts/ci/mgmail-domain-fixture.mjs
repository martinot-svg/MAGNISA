/**
 * Fake provider proof for an ISOLATED Supabase integration database only.
 * Does not invoke Resend or publish any real identity on the Internet.
 */
export async function ensureMGMailCIVerifiedDomain(admin, organizationId) {
  const found = await admin.from("mgmail_verified_domains")
    .select("id,organization_id").eq("domain_name","example.org").maybeSingle();
  if(found.error) throw found.error;
  if(found.data && found.data.organization_id!==organizationId) {
    throw Error("CI proof belongs to another organization.");
  }
  const values={
    organization_id:organizationId,domain_name:"example.org",
    provider:"resend",provider_domain_id:"ci-example-org",
    sending_verified:true,receiving_verified:true,
    ownership_approved:true,operator_reference:"CI local only",
    provider_checked_at:new Date().toISOString(),
  };
  const r=found.data
    ? await admin.from("mgmail_verified_domains").update(values)
      .eq("id",found.data.id).select("id").single()
    : await admin.from("mgmail_verified_domains").insert(values)
      .select("id").single();
  if(r.error||!r.data)throw r.error||Error("CI domain proof unavailable.");
  return r.data.id;
}
