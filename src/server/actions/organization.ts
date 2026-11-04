"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/current-org";

export async function selectOrganizationAction(formData: FormData) {
  const { supabase, user } = await requireUser();
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!organizationId) throw new Error("Sélectionne une organisation.");

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error || !membership) throw new Error("Cette organisation ne fait pas partie de tes accès actifs.");

  const cookieStore = await cookies();
  cookieStore.set("magnisa_active_org", organizationId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}
