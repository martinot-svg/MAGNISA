// Test-only helper for disposable local Supabase CI projects.
// The private table is intentionally not exposed through the REST API;
// this service-role-only RPC is the supported fixture entry point.
export async function seedAdultMajorityFixture(admin, userId) {
  const { error } = await admin.rpc("register_magnisa_signup_age", {
    p_user: userId,
    p_birth_date: "1990-01-01",
    p_majority_confirmed: true,
  });
  if (error) throw new Error("Could not seed synthetic majority record: " + error.message);
}
