import Link from "next/link";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";

export default async function LoanLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  const canConfigureAccounting = await hasPermission(ctx, "accounting.manage");

  return (
    <>
      {canConfigureAccounting ? (
        <div className="actions" style={{ justifyContent: "flex-end", marginBottom: "1rem" }}>
          <Link className="button secondary" href={`/emprunts/${id}/avenant`}>Ajouter un avenant bancaire</Link>
        </div>
      ) : null}
      {children}
    </>
  );
}
