import { requireUser } from "@/lib/current-org";
import { CompanyCreationWizard } from "@/components/company-creation-wizard";
import { redirect } from "next/navigation";

export default async function Onboarding() {
  const { supabase, user } = await requireUser();
  const { data: memberships, error } = await supabase.from("organization_members")
    .select("organization_id").eq("user_id",user.id).eq("status","active").limit(1);
  if(error) throw new Error("Impossible de consulter vos entreprises.");
  if(memberships?.length) redirect("/choisir-organisation");
  return <CompanyCreationWizard year={new Date().getUTCFullYear()}/>;
}
