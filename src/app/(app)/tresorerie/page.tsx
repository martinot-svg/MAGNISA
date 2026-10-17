import { randomUUID } from "node:crypto";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import {assertPermission, requirePermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import { FinancialAccountCreationFields } from "@/components/financial-account-creation-fields";
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
    if(!/^\\+261\\d{9}$/.test(phone)) throw new Error("Numéro Mobile Money invalide (format +261XXXXXXXXX).");
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
  const [{ data: accounts = [] }, { data: org }] = await Promise.all([
    supabase
      .from("financial_accounts")
      .select("id,name,type,balance,is_active,mvola_account_category")
      .eq("organization_id", organizationId)
      .order("name"),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);

  return (
    <>
      <div className="pageHead">
        <div>
          <h1>Trésorerie</h1>
          <p>Banque, caisse, Mobile Money, chèques et transferts internes.</p>
        </div>
      </div>

      <div className="twoCols">
        <section>
          {!accounts.length ? (
            <EmptyState
              title="Aucun compte financier"
              description="Crée le compte réel de l'entreprise. Aucun solde fictif n'est préchargé."
            />
          ) : (
            <div className="grid2">
              {accounts.map((a: any) => (
                <div className="card" key={a.id}>
                  <div className="muted">{a.type === "mobile_money" && a.mvola_account_category === "personal" ? "MVola Particulier classique" : a.type === "mobile_money" && a.mvola_account_category === "business" ? "MVola Entreprise" : a.type === "mobile_money" && a.mvola_account_category === "merchant" ? "Marchand MVola" : a.type === "mobile_money" ? "Mobile Money — catégorie non renseignée" : a.type}</div>
                  <h3>{a.name}</h3>
                  <Link href={`/tresorerie/comptes/${a.id}`} className="button">Voir les mouvements</Link>
                  <div className="metric">{money(a.balance, org?.currency || "MGA")}</div>
                  {!a.is_active && <div className="muted">Compte inactif</div>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Nouveau compte</h2>
          <p className="muted">
            Le solde n'est jamais saisi manuellement : il évolue uniquement par les opérations enregistrées.
          </p>
          <form action={createAccount} className="form">
            <FinancialAccountCreationFields />
          </form>
        </section>
      </div>

      {accounts.filter((a: any) => a.is_active).length >= 2 && (
        <div className="card section">
          <h2>Transfert interne</h2>
          <p className="muted">
            Un transfert déplace la trésorerie entre deux comptes sans créer de chiffre d'affaires ni de charge.
          </p>
          <form action={transferFunds} className="form"><input type="hidden" name="idempotency_key" value={randomUUID()}/>
            <div className="grid2">
              <div className="field">
                <label>Depuis</label>
                <select name="from" required>
                  <option value="">Sélectionner</option>
                  {accounts
                    .filter((a: any) => a.is_active)
                    .map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Vers</label>
                <select name="to" required>
                  <option value="">Sélectionner</option>
                  {accounts
                    .filter((a: any) => a.is_active)
                    .map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label>Montant</label>
                <input name="amount" type="number" min="0.01" step="0.01" required />
              </div>
              <div className="field">
                <label>Date</label>
                <input name="date" type="date" required />
              </div>
            </div>
            <div className="field">
              <label>Référence</label>
              <input name="reference" />
            </div>
            <button className="button primary">Transférer</button>
          </form>
        </div>
      )}
    </>
  );
}
