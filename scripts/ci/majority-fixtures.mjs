// Local CI fixtures only: synthetic Auth users need the same server-side
// majority record that real signups receive from the Auth trigger.
// Never use this helper against production data.
export async function seedAdultMajorityFixture(admin, userId) {
  const { error } = await admin.from("magnisa_signup_age_checks").insert({
    user_id: userId, birth_date: "1990-01-01",
    majority_confirmed_at: new Date().toISOString(),
  });
  if (error) throw new Error("Could not seed synthetic majority record: " + error.message);
}
