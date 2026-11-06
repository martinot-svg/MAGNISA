import { appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!url || !serviceKey || !email || !password) {
  throw new Error("Missing local Supabase or test-user environment variables.");
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "MAGNISA Payroll UI Test" },
});
if (error || !data.user) throw error ?? new Error("Supabase did not create the UI test user.");

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `user_id=${data.user.id}\n`);
}
process.stdout.write(`Created isolated local UI test user: ${data.user.id}\n`);
