import { requirePermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { money } from "@/lib/money";

type Obligation = { due_date?: string | null; amount?: number | string | null; paid_amount?: number | string | null; balance_due?: number | string | null; status?: string | null };

function remaining(item: Obligation) {
  if (item.balance_due !== undefined && item.balance_due !== null) return Math.max(0, Number(item.balance_due) || 0);
  return Math.max(0, (Number(item.amount) || 0) - (Number(item.paid_amount) || 0));
}

export default async function Debts() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "finance.view");
  const { supabase, organizationId } = ctx;
  const [{ data: org }, { data: suppliers = [] }, { data: tax = [] }, { data: social = [] }, { data: loans = [] }, { data: partners = [] }] = await Promise.all([
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("supplier_invoices").select("balance_due,due_date,status,suppliers(name)").eq("organization_id", organizationId).gt("balance_due", 0).neq("status", "cancelled"),
    supabase.from("tax_obligations").select("obligation_type,amount,paid_amount,due_date,status").eq("organization_id", organizationId).neq("status", "cancelled"),
    supabase.from("social_obligations").select("organization_name,amount,paid_amount,due_date,status").eq("organization_id", organizationId).neq("status", "cancelled"),
    supabase.from("loans").select("lender_name,outstanding_principal,next_due_date,next_due_amount,status").eq("organization_id", organizationId).eq("status", "active"),
    supabase.from("partner_account_movements").select("partner_account_id,direction,amount,partner_accounts(partner_name)").eq("organization_id", organizationId),
  ]);

  const currency = org?.currency || "MGA";
  const today = new Date().toISOString().slice(0, 10);
  const supplierTotal = suppliers.reduce((sum: number, item: any) => sum + remaining(item), 0);
  const taxTotal = tax.reduce((sum: number, item: any) => sum + remaining(item), 0);
  const socialTotal = social.reduce((sum: number, item: any) => sum + remaining(item), 0);
  const loanTotal = loans.reduce((sum: number, item: any) => sum + Math.max(0, Number(item.outstanding_principal) || 0), 0);
  const partnerBalances = new Map<string, number>();
  for (const movement of partners as any[]) {
    const id = String(movement.partner_account_id);
    partnerBalances.set(id, (partnerBalances.get(id) || 0) + (movement.direction === "company_owes_partner" ? Number(movement.amount || 0) : -Number(movement.amount || 0)));
  }
  const partnerPayables = [...partnerBalances.values()].reduce((sum, balance) => sum + Math.max(0, balance), 0);
  const partnerReceivables = [...partnerBalances.values()].reduce((sum, balance) => sum + Math.max(0, -balance), 0);

  const overdueSuppliers = suppliers.filter((item: any) => item.due_date && item.due_date < today && remaining(item) > 0);
  const overdueTax = tax.filter((item: any) => item.due_date && item.due_date < today && remaining(item) > 0);
  const overdueSocial = social.filter((item: any) => item.due_date && item.due_date < today && remaining(item) > 0);
  const overdueLoans = loans.filter((item: any) => item.next_due_date && item.next_due_date < today && Number(item.next_due_amount || 0) > 0);
  const overdueSupplierTotal = overdueSuppliers.reduce((sum: number, item: any) => sum + remaining(item), 0);
  const overdueTaxTotal = overdueTax.reduce((sum: number, item: any) => sum + remaining(item), 0);
  const overdueSocialTotal = overdueSocial.reduce((sum: number, item: any) => sum + remaining(item), 0);
  const overdueLoanTotal = overdueLoans.reduce((sum: number, item: any) => sum + Math.max(0, Number(item.next_due_amount) || 0), 0);
  const overdueTotal = overdueSupplierTotal + overdueTaxTotal + overdueSocialTotal + overdueLoanTotal;

  const rows = [
    { name: "Créances sur les associés (à recevoir, hors dettes)", value: partnerReceivables },
    { name: "Fournisseurs", value: supplierTotal },
    { name: "Fiscalité", value: taxTotal },
    { name: "Cotisations sociales & santé", value: socialTotal },
    { name: "Emprunts - capital restant", value: loanTotal },
    { name: "Comptes associés - position nette due", value: partnerPayables },
  ];

  const overdueRows = [
    { name: "Factures fournisseurs", count: overdueSuppliers.length, value: overdueSupplierTotal },
    { name: "Obligations fiscales", count: overdueTax.length, value: overdueTaxTotal },
    { name: "Obligations sociales", count: overdueSocial.length, value: overdueSocialTotal },
    { name: "Échéances de prêts", count: overdueLoans.length, value: overdueLoanTotal },
  ];

  return (
    <>
      <div className="pageHead">
        <div>
          <p className="eyebrow">Position financière</p>
          <h1>Dettes & engagements</h1>
          <p>Vue consolidée des sommes que l'entreprise devra payer. Les montants dus par les associés restent des créances et ne sont pas masqués par compensation.</p>
        </div>
      </div>
      <div className="grid4">
        <div className="card"><div className="muted">Dettes fournisseurs</div><div className="metric">{money(supplierTotal, currency)}</div></div>
        <div className="card"><div className="muted">Fiscal & social</div><div className="metric">{money(taxTotal + socialTotal, currency)}</div></div>
        <div className="card"><div className="muted">Emprunts</div><div className="metric">{money(loanTotal, currency)}</div></div>
        <div className="card"><div className="muted">Dû aux associés</div><div className="metric">{money(partnerPayables, currency)}</div></div>
      </div>
      <section className="card section">
        <h2>Échéances en retard</h2>
        <p>Calculé à partir des dates d'échéance et des soldes encore dus, à la date du jour.</p>
        <div className="metric">{money(overdueTotal, currency)}</div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Catégorie</th><th>Éléments en retard</th><th className="right">Montant en retard</th></tr></thead>
            <tbody>
              {overdueRows.map(row => <tr key={row.name}><td>{row.name}</td><td>{row.count}</td><td className="right"><b>{money(row.value, currency)}</b></td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="muted">Pour les prêts, ce total représente uniquement la prochaine échéance renseignée comme échue, et non le capital restant total. Une échéance sans date ou sans montant n'est pas classée comme retardée.</p>
      </section>
      <section className="card section">
        <h2>Position des associés - non compensée</h2>
        <p>Sommes dues aux associés : {money(partnerPayables, currency)}. Sommes dues par les associés : {money(partnerReceivables, currency)}. Les créances ne réduisent pas artificiellement les dettes présentées.</p>
      </section>
      <section className="card section">
        <h2>Composition</h2>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Nature</th><th className="right">Montant</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.name}><td>{row.name}</td><td className="right"><b>{money(row.value, currency)}</b></td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
