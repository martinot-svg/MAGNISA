import { requireUser } from "@/lib/current-org";
import { CompanyCreationWizard } from "@/components/company-creation-wizard";
export default async function CreateAdditionalCompany() {
  await requireUser();
  return <CompanyCreationWizard year={new Date().getUTCFullYear()}/>;
}
