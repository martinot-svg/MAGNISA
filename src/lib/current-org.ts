import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (
    !user.email_confirmed_at ||
    profile?.account_status === "pending_verification"
  ) {
    redirect(`/verify-email?email=${encodeURIComponent(user.email || "")}`);
  }

  if (profile?.account_status === "suspended") {
    redirect("/login?status=suspended");
  }

  return { supabase, user };
}

export async function requireOrganization() {
  const { supabase, user } = await requireUser();

  const { data: memberships, error } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(50);

  if (process.env.CI === "true") {
    console.info("[org-context] membership_count=", memberships?.length ?? 0, "query_error=", error?.code ?? "none");
  }
  if (error) {
    throw new Error("Impossible de charger les organisations autorisées.");
  }

  if (!memberships?.length) redirect("/onboarding");

  const cookieStore = await cookies();
  const selectedOrganizationId = cookieStore.get("magnisa_active_org")?.value;

  if (selectedOrganizationId) {
    const selectedMembership = memberships.find(
      (membership) => membership.organization_id === selectedOrganizationId,
    );

    if (!selectedMembership) redirect("/choisir-organisation");

    return {
      supabase,
      user,
      organizationId: selectedMembership.organization_id as string,
      role: selectedMembership.role as string,
    };
  }

  if (memberships.length > 1) redirect("/choisir-organisation");

  const membership = memberships[0];
  return {
    supabase,
    user,
    organizationId: membership.organization_id as string,
    role: membership.role as string,
  };
}
