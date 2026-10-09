import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const {data:profile}=await supabase.from("profiles").select("account_status").eq("id",user.id).maybeSingle();
  if(!user.email_confirmed_at || profile?.account_status==="pending_verification"){
    redirect(`/verify-email?email=${encodeURIComponent(user.email||"")}`);
  }
  if(profile?.account_status==="suspended") redirect("/login?status=suspended");

  return { supabase, user };
}

export async function requireOrganization() {
  const { supabase, user } = await requireUser();
  const { data: member } = await supabase.from("organization_members").select("organization_id, role").eq("user_id", user.id).eq("status","active").limit(1).maybeSingle();
  if (!member) redirect("/onboarding");
  return { supabase, user, organizationId: member.organization_id as string, role: member.role as string };
}
