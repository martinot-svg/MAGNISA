import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganization } from "@/lib/current-org";

export default async function EarlyClosurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOrganization();
  const { supabase, organizationId } = ctx;
  const { data: loan } = await supabase.from("loans").select("id,lender_name,status,outstanding_principal").eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (!loan) notFound();
  return <main className="section"><p className="eyebrow"><Link href={`/emprunts/${id}`}>Emprunt</Link> / Clôture anticipée</p><h1>Clôture anticipée</h1><p>{loan.lender_name}</p><p>Capital restant dû : {loan.outstanding_principal}</p><p>Statut : {loan.status}</p></main>;
}
