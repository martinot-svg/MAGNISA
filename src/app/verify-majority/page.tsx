import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VerifyMajorityForm } from "@/components/verify-majority-form";

export default async function VerifyMajorityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email_confirmed_at) redirect(`/verify-email?email=${encodeURIComponent(user.email || "")}`);
  return <VerifyMajorityForm/>;
}
