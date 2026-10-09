import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function requireOrganization() {
  const { supabase, user } = await requireUser();
  const { data: member } = await supabase.from("organization_members").select("organization_id, role").eq("user_id", user.id).eq("status","active").limit(1).maybeSingle();
  if (!member) redirect("/onboarding");
  return { supabase, user, organizationId: member.organization_id as string, role: member.role as string };
}
