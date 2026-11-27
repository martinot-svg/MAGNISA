// Test-only helpers for disposable local Supabase CI projects.
// Stage BEFORE auth.users insertion; the database trigger consumes this atomically.
export async function stageAdultMajorityFixture(admin, email) {
  const { error } = await admin.rpc("stage_magnisa_signup_age", {
    p_email: email, p_birth_date: "1990-01-01", p_majority_confirmed: true,
  });
  if (error) throw new Error("Could not stage synthetic majority record: " + error.message);
}
export async function seedAdultMajorityFixture(admin, userId) {
  const { error } = await admin.rpc("register_magnisa_signup_age", {
    p_user: userId, p_birth_date: "1990-01-01", p_majority_confirmed: true,
  });
  if (error) throw new Error("Could not seed synthetic majority record: " + error.message);
}
