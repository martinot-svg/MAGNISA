import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, requirePermission } from "@/lib/permissions";
import { money } from "@/lib/money";

async function createFiscalYear(formData: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const label = String(formData.get("label") || "").trim();
  const start = String(formData.get("period_start") || "");
  const end = String(formData.get("period_end") || "");
  const raw = String(formData.get("opening_lines") || "");
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [pcg_code, debitRaw, creditRaw] = line.split("|").map((v) => v.trim());
    if (!/^[1-5][0-9]{0,5}$/.test(pcg_code || "")) throw new Error("Chaque ligne doit commencer par un compte PCG de classe 1 à 5.");
    const debit = Number(debitRaw || 0);
    const credit = Number(creditRaw || 0);
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw new Error("Montant de solde initial invalide.");
    }
    return { account_kind: "pcg", pcg_code, debit, credit };
  });
  const { error } = await ctx.supabase.rpc("magnisa_create_fiscal_year", {
    p_org: ctx.organizationId, p_start: start, p_end: end, p_label: label,
    p_opening_lines: lines.length ? lines : null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/exercices-comptables");
  revalidatePath("/comptabilite");
}

async function closeFiscalYear(formData: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "accounting.manage");
  const id = String(formData.get("fiscal_year_id") || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Exercice invalide.");
  const { error } = await ctx.supabase.rpc("magnisa_close_fiscal_year", {
    p_org: ctx.organizationId, p_year: id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/exercices-comptables");
  revalidatePath("/comptabilite");
  revalidatePath("/etats-financiers");
}

export default async function FiscalYears({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const params = await searchParams;
  const ctx = await requireOrganization();
  await requirePermission(ctx, "accounting.view");
  const { supabase, organizationId } = ctx;
  const [{ data: years = [], error: yearsError }, { data: org, error: orgError }] = await Promise.all([
    supabase.from("accounting_fiscal_years")
      .select("id,label,period_start,period_end,status,opening_entry_id,closed_at")
      .eq("organization_id", organizationId).order("period_start", { ascending: false }),
    supabase.from("organizations").select("currency").eq("id", organizationId).single(),
  ]);
  if (yearsError || orgError) throw new Error(yearsError?.message || orgError?.message);
  const selected = (years as any[]).find((y) => y.id === params.year) || (years as any[])[0] || null;
  let balanceRows: any[] = [];
  let resultRows: any[] = [];
  let labels = new Map<string, string>();
  if (selected) {
    const [{ data: balance, error: balanceError }, { data: result, error: resultError }, { data: accounts, error: accountsError }] = await Promise.all([
      supabase.from("pcg2005_journal_lines").select("pcg_code,debit,credit")
        .eq("organization_id", organizationId).eq("status", "posted").lte("entry_date", selected.period_end)
        .gte("pcg_code", "1").lt("pcg_code", "6"),
      supabase.from("pcg2005_journal_lines").select("pcg_code,debit,credit")
        .eq("organization_id", organizationId).eq("status", "posted")
        .gte("entry_date", selected.period_start).lte("entry_date", selected.period_end)
        .gte("pcg_code", "6").lt("pcg_code", "8"),
      supabase.from("pcg2005_accounts").select("code,label"),
    ]);
    if (balanceError || resultError || accountsError) throw new Error(balanceError?.message || resultError?.message || accountsError?.message);
    const aggregate = (rows: any[]) => {
      const map = new Map<string, { debit: number; credit: number }>();
      for (const row of rows || []) {
        if (!row.pcg_code) continue;
        const old = map.get(row.pcg_code) || { debit: 0, credit: 0 };
        old.debit += Number(row.debit || 0);
        old.credit += Number(row.credit || 0);
        map.set(row.pcg_code, old);
      }
      return [...map.entries()].map(([code, v]) => ({ code, debit: v.debit, credit: v.credit, balance: v.debit - v.credit }))
        .filter((r) => Math.abs(r.balance) >= 0.005).sort((a, b) => a.code.localeCompare(b.code));
    };
    balanceRows = aggregate(balance || []);
    resultRows = aggregate(result || []);
    labels = new Map((accounts || []).map((a: any) => [a.code, a.label]));
  }
  const currency = org?.currency || "MGA";
  const totalAssets = balanceRows.filter((r) => /^[2-5]/.test(r.code)).reduce((n, r) => n + r.balance, 0);
  const totalEquityLiabilities = balanceRows.filter((r) => /^1/.test(r.code)).reduce((n, r) => n - r.balance, 0);
  const profit = resultRows.reduce((n, r) => n - r.balance, 0);
  const isFirstYear = (years as any[]).length === 0;
  return <>
    <div className="pageHead">
      <div><h1>Exercices comptables</h1><p>Ouverture, report des soldes, résultat et clôture selon le PCG 2005 de Madagascar.</p></div>
      <a className="button" href="/comptabilite">Retour à la comptabilité</a>
    </div>
    <section className="card section">
      <h2>Créer un exercice</h2>
      <p className="muted">Après un exercice clôturé, MAGNISA reprend automatiquement les soldes des comptes de bilan PCG 1 à 5, y compris le résultat transféré en 120 ou 129. Pour le premier exercice, renseigne les soldes initiaux équilibrés.</p>
      <form action={createFiscalYear} className="form">
        <div className="grid2">
          <div className="field"><label>Libellé</label><input name="label" required placeholder="Exercice 2026" /></div>
          <div className="field"><label>Date d'ouverture</label><input name="period_start" type="date" required /></div>
          <div className="field"><label>Date de clôture</label><input name="period_end" type="date" required /></div>
        </div>
        <div className="field">
          <label>Soldes initiaux du premier exercice (une ligne par compte)</label>
          <textarea name="opening_lines" rows={5} placeholder={"101|0|45000000\n512|35000000|0\n53|5000000|0\n411|12000000|0\n401|0|7000000"} />
          <p className="muted">Format : code PCG|débit|crédit. Comptes de bilan uniquement (classes 1 à 5). Les débits doivent égaler les crédits. Laisse vide pour un exercice suivant : le report sera automatique.</p>
        </div>
        <button className="button primary">Créer et générer les à-nouveaux</button>
      </form>
    </section>
    <section className="section">
      <h2>Historique des exercices</h2>
      {!years?.length ? <p className="muted">Aucun exercice comptable n'est encore créé.</p> : <div className="tableWrap"><table>
        <thead><tr><th>Exercice</th><th>Ouverture</th><th>Clôture</th><th>Statut</th><th>Pièce d'ouverture</th><th></th></tr></thead>
        <tbody>{(years as any[]).map((year) => <tr key={year.id}>
          <td><a href={`/exercices-comptables?year=${year.id}`}>{year.label}</a></td><td>{year.period_start}</td><td>{year.period_end}</td>
          <td><span className={year.status === "closed" ? "badge success" : "badge"}>{year.status === "closed" ? "Clôturé" : "Ouvert"}</span></td>
          <td>{year.opening_entry_id ? "Générée" : "Absente"}</td>
          <td>{year.status === "open" && <form action={closeFiscalYear}><input type="hidden" name="fiscal_year_id" value={year.id} /><button className="button">Clôturer</button></form>}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {selected && <>
      <section className="grid3">
        <div className="card"><div className="muted">Total actif (comptes 2 à 5)</div><div className="metric">{money(totalAssets, currency)}</div></div>
        <div className="card"><div className="muted">Capitaux et dettes (classe 1)</div><div className="metric">{money(totalEquityLiabilities, currency)}</div></div>
        <div className="card"><div className="muted">Résultat de l'exercice</div><div className="metric">{money(profit, currency)}</div></div>
      </section>
      <section className="section">
        <h2>Bilan à la date du {selected.period_end}</h2>
        <p className="muted">Soldes cumulés depuis les à-nouveaux jusqu'à la date de clôture. Les comptes 1 à 5 sont présentés avant clôture ou après report selon le statut de l'exercice.</p>
        <div className="tableWrap"><table><thead><tr><th>Compte PCG</th><th>Intitulé</th><th className="right">Solde débiteur</th><th className="right">Solde créditeur</th></tr></thead>
          <tbody>{balanceRows.map((r) => <tr key={r.code}><td>{r.code}</td><td>{labels.get(r.code) || "Compte PCG"}</td><td className="right">{money(Math.max(r.balance,0),currency)}</td><td className="right">{money(Math.max(-r.balance,0),currency)}</td></tr>)}</tbody>
        </table></div>
        <p><strong>Actif : {money(totalAssets,currency)} | Capitaux et dettes : {money(totalEquityLiabilities,currency)} | Écart avec résultat non clôturé : {money(totalAssets-totalEquityLiabilities-profit,currency)}</strong></p>
      </section>
      <section className="section">
        <h2>Compte de résultat</h2>
        <div className="tableWrap"><table><thead><tr><th>Compte PCG</th><th>Intitulé</th><th className="right">Débit</th><th className="right">Crédit</th><th className="right">Solde</th></tr></thead>
          <tbody>{resultRows.map((r) => <tr key={r.code}><td>{r.code}</td><td>{labels.get(r.code) || "Compte PCG"}</td><td className="right">{money(r.debit,currency)}</td><td className="right">{money(r.credit,currency)}</td><td className="right">{money(-r.balance,currency)}</td></tr>)}</tbody>
        </table></div>
      </section>
    </>}
  </>;
}
