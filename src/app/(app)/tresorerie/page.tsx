import { randomUUID } from "node:crypto";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import {assertPermission, requirePermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { TreasuryAccountDialog } from "@/components/treasury-account-dialog";
import { TreasuryNavigation } from "@/components/treasury-navigation";
import { TreasuryDashboardChart } from "@/components/treasury-dashboard-chart";
import { transferFunds } from "@/server/actions/core";

async function createAccount(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "treasury.transfer");

  const type=String(fd.get("type")||"");
  if(!["bank","cash","mobile_money","cheque_clearing"].includes(type)) throw new Error("Type de compte invalide.");
  const field=(key:string)=>String(fd.get(key)||"").trim();
  const currency=field("currency");
  if(!["MGA","EUR","USD"].includes(currency)) throw new Error("Devise invalide.");
  let name=field("name");
  const details:Record<string,string>={currency};
  if(type==="mobile_money"){
    const service=field("service");
    if(!["MVola","Orange Money","Airtel Money"].includes(service)) throw new Error("Service Mobile Money invalide.");
    const operator=service==="MVola"?"Yas":service==="Orange Money"?"Orange":"Airtel";
    const phone=field("phone").replace(/[ .-]/g,"");
    if(!/^\+261\d{9}$/.test(phone)) throw new Error("Numéro Mobile Money invalide (format +261XXXXXXXXX).");
    const accountType=field("account_category");
    if(!["personal","business","merchant"].includes(accountType)) throw new Error("Type de compte Mobile Money invalide.");
    name=service;
    Object.assign(details,{service,operator,phone,account_type:accountType});
  }else if(type==="bank"){
    const bank=field("bank")==="Autre"?field("other_bank"):field("bank");
    const bankType=field("bank_type"),holder=field("holder"),accountNumber=field("account_number");
    if(!bank||!holder||!accountNumber||!["current","savings","term","other"].includes(bankType)) throw new Error("Informations bancaires incomplètes.");
    name=bank;
    Object.assign(details,{bank,bank_type:bankType,holder,account_number:accountNumber,branch:field("branch"),rib:field("rib"),description:field("description")});
  }else if(type==="cash"){
    if(!name||!field("responsible")||!["main","secondary","petty","sales","other"].includes(field("cash_type"))) throw new Error("Informations de caisse incomplètes.");
    Object.assign(details,{cash_type:field("cash_type"),responsible:field("responsible"),location:field("location"),description:field("description")});
  }else{
    if(!name||!["clients","other","all"].includes(field("cheque_category"))) throw new Error("Informations de chèques incomplètes.");
    Object.assign(details,{category:field("cheque_category"),responsible:field("responsible"),description:field("description")});
  }
  const {error}=await ctx.supabase.rpc("create_financial_account_detailed",{p_org:ctx.organizationId,p_type:type,p_name:name,p_details:details});
  if(error) throw new Error(error.message);
  revalidatePath("/tresorerie");
  revalidatePath("/dashboard");
}

export default async function Treasury(){const ctx=await requireOrganization();await requirePermission(ctx,"treasury.view");const {supabase,organizationId}=ctx;
  const [{ data: accounts = [] }, { data: org }, {data:transactions=[]},{data:reconciliations=[]}] = await Promise.all([
    supabase
      .from("financial_accounts")
      .select("id,name,type,balance,is_active,mvola_account_category")
      .eq("organization_id", organizationId)
      .order("name"),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
    supabase.from("financial_transactions").select("id,financial_account_id,transaction_date,amount,kind,description,reference").eq("organization_id",organizationId).order("transaction_date",{ascending:false}).limit(100),
    supabase.from("magnisa_account_reconciliation").select("financial_account_id,name,balance,movements_sum,balance_difference,reconciliation_status").eq("organization_id",organizationId),
  ]);

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Trésorerie</h1>
          <p>Banque, caisse, Mobile Money, chèques et transferts internes.</p>
        </div>
        <TreasuryAccountDialog createAccount={createAccount} />
      </div>

      <TreasuryNavigation
        dashboard={<section className="section">
          <h2>Tableau de bord de trésorerie</h2>
          <TreasuryDashboardChart active={accounts.filter((a:any)=>a.is_active).length} total={accounts.length} inflows={transactions.filter((t:any)=>t.kind==="inflow").length} outflows={transactions.filter((t:any)=>t.kind==="outflow").length}/>
          <p className="muted">Les soldes de comptes sont consultables dans Comptes. Les montants en devises différentes ne sont pas additionnés.</p>
          <h3>Activité récente</h3>
          {!transactions.length?<EmptyState title="Aucun mouvement" description="Les opérations réelles enregistrées apparaîtront ici."/>:
          <div className="card">{transactions.slice(0,5).map((t:any)=><p key={t.id}><strong>{t.transaction_date}</strong> · {t.description||t.reference||t.kind} · {money(t.amount,org?.currency||"MGA")}</p>)}</div>}
        </section>}
        accounts={<section className="section">
          <h2>Comptes de trésorerie</h2>
          {!accounts.length?<EmptyState title="Aucun compte financier" description="Clique sur Nouveau compte en haut à droite pour créer ton premier compte."/>:
          <div className="grid2">{accounts.map((a:any)=><div className="card" key={a.id}>
            <div className="muted">{a.type==="bank"?"Banque":a.type==="cash"?"Caisse":a.type==="mobile_money"?"Mobile Money":"Chèques à encaisser"}</div>
            <h3>{a.name}</h3><div className="metric">{money(a.balance,org?.currency||"MGA")}</div>
            {!a.is_active&&<p className="muted">Compte inactif</p>}
            <Link className="button" href={`/tresorerie/comptes/${a.id}`}>Voir les mouvements</Link>
          </div>)}</div>}
        </section>}
        movements={<section className="section"><h2>Mouvements de trésorerie</h2>
          {!transactions.length?<EmptyState title="Aucun mouvement" description="Les entrées, sorties et transferts validés apparaîtront ici."/>:
          <div className="card" style={{overflowX:"auto"}}><table style={{width:"100%"}}><thead><tr><th>Date</th><th>Compte</th><th>Opération</th><th>Référence</th><th>Montant</th></tr></thead><tbody>
            {transactions.map((t:any)=><tr key={t.id}><td>{t.transaction_date}</td><td>{accounts.find((a:any)=>a.id===t.financial_account_id)?.name||"Compte indisponible"}</td><td>{t.description||t.kind}</td><td>{t.reference||"—"}</td><td>{money(t.amount,org?.currency||"MGA")}</td></tr>)}
          </tbody></table></div>}
        </section>}
        transfers={<section className="section"><h2>Transferts internes</h2>
          <p className="muted">Un transfert déplace la trésorerie entre deux comptes sans créer de chiffre d'affaires ni de charge.</p>
          {accounts.filter((a:any)=>a.is_active).length<2?<EmptyState title="Deux comptes requis" description="Crée au moins deux comptes actifs pour réaliser un transfert."/>:
          <div className="card"><form action={transferFunds} className="form">
            <input type="hidden" name="idempotency_key" value={randomUUID()}/>
            <div className="grid2"><div className="field"><label>Depuis</label><select name="from" required><option value="">Sélectionner</option>{accounts.filter((a:any)=>a.is_active).map((a:any)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div className="field"><label>Vers</label><select name="to" required><option value="">Sélectionner</option>{accounts.filter((a:any)=>a.is_active).map((a:any)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></div></div>
            <div className="grid2"><div className="field"><label>Montant</label><input name="amount" type="number" min="0.01" step="0.01" required/></div><div className="field"><label>Date</label><input name="date" type="date" required/></div></div>
            <div className="field"><label>Référence</label><input name="reference"/></div><button className="button primary">Transférer</button>
          </form></div>}
        </section>}
        reconciliation={<section className="section"><h2>Rapprochement des comptes</h2>
          <p className="muted">Contrôle de cohérence entre les soldes MAGNISA et les mouvements enregistrés. Ce contrôle ne constitue pas un rapprochement avec un relevé bancaire externe.</p>
          {!reconciliations.length?<EmptyState title="Aucun rapprochement disponible" description="Aucune donnée de contrôle à afficher."/>:
          <div className="card" style={{overflowX:"auto"}}><table style={{width:"100%"}}><thead><tr><th>Compte</th><th>Solde</th><th>Somme des mouvements</th><th>Écart</th><th>État</th></tr></thead><tbody>
          {reconciliations.map((a:any)=><tr key={a.financial_account_id}><td>{a.name}</td><td>{money(a.balance,org?.currency||"MGA")}</td><td>{money(a.movements_sum,org?.currency||"MGA")}</td><td>{money(a.balance_difference,org?.currency||"MGA")}</td><td>{a.reconciliation_status||"À contrôler"}</td></tr>)}
          </tbody></table></div>}
        </section>}
      />
    </>
  );
}
