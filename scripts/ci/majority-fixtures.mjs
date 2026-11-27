// Test-only helper. Call only against disposable local CI Supabase projects.
export async function seedAdultMajorityFixture(admin, userId) {
  const { error } = await admin.from("magnisa_signup_age_checks").insert({
    user_id: userId, birth_date: "1990-01-01",
    majority_confirmed_at: new Date().toISOString(),
  });
  if (error) throw new Error("Could not seed synthetic majority record: " + error.message);
}
