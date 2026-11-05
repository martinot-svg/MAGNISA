import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { requireUser } from "@/lib/current-org";
import { selectOrganizationAction } from "@/server/actions/organization";

export default async function SelectOrganizationPage() {
  const { supabase, user } = await requireUser();

  const { data: memberships, error } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) throw new Error("Impossible de charger tes organisations.");
  if (!memberships?.length) redirect("/onboarding");
  if (memberships.length === 1) redirect("/");

  const { data: organizations, error: organizationsError } = await supabase
    .from("organizations")
    .select("id, name")
    .in(
      "id",
      memberships.map((membership) => membership.organization_id),
    );

  if (organizationsError) {
    throw new Error("Impossible de charger les informations des organisations.");
  }

  const names = new Map(
    (organizations ?? []).map((organization) => [
      organization.id,
      organization.name,
    ]),
  );

  return (
    <main className="auth authPremium">
      <BrandMark />
      <div>
        <p className="eyebrow">Espace sécurisé</p>
        <h1>Choisir une organisation</h1>
        <p className="muted">
          Ton compte dispose de plusieurs accès. Choisis l'entreprise sur
          laquelle tu souhaites travailler.
        </p>
      </div>

      {memberships.map((membership) => (
        <form
          action={selectOrganizationAction}
          className="form"
          key={membership.organization_id}
        >
          <input
            type="hidden"
            name="organization_id"
            value={membership.organization_id}
          />
          <button className="button primary" type="submit">
            {names.get(membership.organization_id) || "Organisation"}
          </button>
        </form>
      ))}
    </main>
  );
}
