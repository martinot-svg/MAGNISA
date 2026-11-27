// Test-only staging helper for disposable local Supabase CI projects.
// Always call this before admin.auth.admin.createUser so the auth.users trigger
// consumes the server-validated majority staging row atomically.
export async function stageAdultMajorityFixture(admin, email) {
  const { error } = await admin.rpc("stage_magnisa_signup_age", {
    p_email: email,
    p_birth_date: "1990-01-01",
    p_majority_confirmed: true,
  });
  if (error) throw new Error("Could not stage synthetic majority record: " + error.message);
}
