import { requireOrganization } from "@/lib/current-org";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { EmptyState } from "@/components/empty-state";
import { money } from "@/lib/money";
import {
  addInventoryCountLine,
  approveInventoryCount,
  createInventoryCount,
  deleteInventoryCountLine,
  reverseInventoryCount,
} from "@/server/actions/inventory";

export default async function InventoryCounts({searchParams}:any) {
  const params=await searchParams;
  const ctx=await requireOrganization();
  await requirePermission(ctx,"accounting.view");
  const [
    {data:years=[],error:yearsError},
    {data:counts=[],error:countsError},
    {data:accounts=[],error:accountsError},
    {data:organization},
  ]=await Promise.all([
    ctx.supabase.from("accounting_fiscal_years")
      .select("id,label,period_start,period_end,status")
      .eq("organization_id",ctx.organizationId)
      .order("period_start",{ascending:false}),
    ctx.supabase.from("inventory_counts")
      .select("id,fiscal_year_id,count_date,valuation_method,status,notes,approved_at,reversal_reason,created_at")
      .eq("organization_id",ctx.organizationId)
      .order("created_at",{ascending:false}).limit(30),
    ctx.supabase.from("pcg2005_accounts").select("code,label").order("code"),
    ctx.supabase.from("organizations").select("currency").eq("id",ctx.organizationId).single(),
  ]);
  if(yearsError)throw new Error("Impossible de charger les exercices : "+yearsError.message);
  if(countsError)throw new Error("Impossible de charger les inventaires : "+countsError.message);
  if(accountsError)throw new Error("Impossible de charger les comptes PCG : "+accountsError.message);

  const currency=organization?.currency||"MGA";
  const canManage=await hasPermission(ctx,"accounting.manage");
  const count=counts.find((c:any)=>c.id===params?.count)||counts.find((c:any)=>["draft","approved"].includes(c.status))||counts[0]||null;
  const {data:lines=[],error:linesError}=count
    ? await ctx.supabase.from("inventory_count_lines")
        .select("id,item_reference,description,unit,account_code,quantity,unit_cost,gross_value,impairment_amount,impairment_account_code,net_value")
        .eq("organization_id",ctx.organizationId).eq("count_id",count.id).order("item_reference")
    : {data:[],error:null};
  if(linesError)throw new Error("Impossible de charger les lignes d'inventaire : "+linesError.message);

  const stockAccounts=accounts.filter((a:any)=>/^3[1-8]/.test(a.code));
  const impairmentAccounts=accounts.filter((a:any)=>/^39(1|2|3|4|5|7|8)$/.test(a.code));
  const availableYears=years.filter((year:any)=>!counts.some((c:any)=>c.fiscal_year_id===year.id&&["draft","approved"].includes(c.status)));
  const totalGross=lines.reduce((sum:number,line:any)=>sum+Number(line.gross_value||0),0);
  const totalImpairment=lines.reduce((sum:number,line:any)=>sum+Number(line.impairment_amount||0),0);
  const totalNet=totalGross-totalImpairment;

  return <>
    <div className="pageHead">
      <div>
        <h1>Inventaire physique des stocks</h1>
        <p>Inventaire intermittent de clôture, valorisation au coût CUMP, FIFO ou identification spécifique, dépréciations et rapprochement avec les comptes 3 et 39.</p>
      </div>
    </div>
    <div className="grid3">
      <section className="card"><div className="muted">Articles comptés</div><div className="metric">{lines.length}</div></section>
      <section className="card"><div className="muted">Valeur brute</div><div className="metric">{money(totalGross,currency)}</div></section>
      <section className="card"><div className="muted">Valeur nette</div><div className="metric">{money(totalNet,currency)}</div><div className="muted">Dépréciations : {money(totalImpairment,currency)}</div></section>
    </div>

    {!years.length?<section className="card section"><EmptyState title="Aucun exercice comptable" description="Un inventaire de clôture doit être rattaché à un exercice comptable et daté de sa date de clôture. Aucun exercice n'est actuellement disponible."/></section>:null}

    {canManage===true&&!count&&availableYears.length>0&&<section className="card section">
      <h2>Créer un inventaire de clôture</h2>
      <p className="muted">Un seul brouillon ou inventaire approuvé est autorisé par exercice. La date est obligatoirement celle de clôture. Un inventaire vide peut être approuvé pour confirmer l'absence de stock.</p>
      <FormDialog title="Créer un inventaire physique" buttonLabel="Créer le brouillon d'inventaire"><form action={createInventoryCount} className="form">
        <div className="grid3">
          <div className="field"><label>Exercice</label><select name="fiscal_year_id" required defaultValue=""><option value="" disabled>Choisir un exercice</option>{availableYears.map((year:any)=><option key={year.id} value={year.id}>{year.label} • {year.period_start} au {year.period_end}</option>)}</select></div>
          <div className="field"><label>Date du comptage</label><select name="count_date" required defaultValue=""><option value="" disabled>Choisir la date de clôture</option>{availableYears.map((year:any)=><option key={year.id} value={year.period_end}>{year.period_end}</option>)}</select></div>
          <div className="field"><label>Méthode de valorisation</label><select name="valuation_method" defaultValue="CUMP"><option value="CUMP">Coût unitaire moyen pondéré (CUMP)</option><option value="FIFO">Premier entré, premier sorti (FIFO)</option><option value="specific_identification">Identification spécifique</option></select></div>
        </div>
        <div className="field"><label>Observations et références des pièces</label><textarea name="notes" rows={3} maxLength={2000}/></div>
        <button className="button primary" type="submit">Créer le brouillon d'inventaire</button>
      </form></FormDialog>
    </section>}

    {canManage===true&&!count&&years.length>0&&availableYears.length===0&&<section className="card section"><EmptyState title="Aucun exercice disponible pour un nouvel inventaire" description="Chaque exercice possède déjà un inventaire brouillon ou approuvé. Contrepasser un inventaire approuvé avant de le remplacer."/></section>}

    {count&&<section className="card section">
      <div className="pageHead">
        <div><h2>Inventaire sélectionné : {count.count_date}</h2><p className="muted">Exercice : {years.find((y:any)=>y.id===count.fiscal_year_id)?.label||"—"} • Méthode : {count.valuation_method} • Statut : {count.status}</p></div>
        {count.status==="approved"&&<span className="badge success">Approuvé</span>}
        {count.status==="draft"&&<span className="badge warning">Brouillon</span>}
        {count.status==="reversed"&&<span className="badge">Contrepassé</span>}
      </div>
      {count.notes&&<p className="muted">{count.notes}</p>}
      {count.status==="approved"&&<p className="muted">Approuvé le {count.approved_at?new Date(count.approved_at).toLocaleString("fr-FR"):"—"}. Les lignes sont verrouillées.</p>}
      {count.status==="reversed"&&<p className="muted">Motif de contrepassation : {count.reversal_reason||"—"}</p>}

      {count.status==="draft"&&canManage===true&&<FormDialog title="Ajouter une ligne de comptage" buttonLabel="Ajouter la ligne"><form action={addInventoryCountLine} className="form">
        <h3>Ajouter un article ou un en-cours</h3>
        <input type="hidden" name="count_id" value={count.id}/>
        <div className="grid3">
          <div className="field"><label>Référence / lot</label><input name="item_reference" required maxLength={80}/></div>
          <div className="field"><label>Désignation</label><input name="description" required maxLength={240}/></div>
          <div className="field"><label>Unité</label><input name="unit" defaultValue="unité" maxLength={24}/></div>
          <div className="field"><label>Compte de stock PCG</label><select name="account_code" required defaultValue=""><option value="" disabled>Choisir un compte 31 à 38</option>{stockAccounts.map((a:any)=><option key={a.code} value={a.code}>{a.code} · {a.label}</option>)}</select></div>
          <div className="field"><label>Quantité physique</label><input name="quantity" type="number" min="0" step="0.000001" required/></div>
          <div className="field"><label>Coût unitaire selon la méthode retenue</label><input name="unit_cost" type="number" min="0" step="0.000001" required/></div>
          <div className="field"><label>Dépréciation</label><input name="impairment_amount" type="number" min="0" step="0.01" defaultValue="0"/></div>
          <div className="field"><label>Compte de dépréciation PCG</label><select name="impairment_account_code" defaultValue=""><option value="">Aucune dépréciation</option>{impairmentAccounts.map((a:any)=><option key={a.code} value={a.code}>{a.code} · {a.label}</option>)}</select></div>
        </div>
        <p className="muted">La quantité et le coût unitaire doivent être justifiés par les feuilles de comptage et les pièces d'achat. MAGNISA calcule automatiquement la valeur brute et la valeur nette.</p>
        <button className="button primary" type="submit">Ajouter la ligne</button>
      </form></FormDialog>}

      <div className="tableWrap">
        <table><thead><tr><th>Référence</th><th>Désignation</th><th>Compte</th><th className="right">Quantité</th><th className="right">Coût unitaire</th><th className="right">Brut</th><th className="right">Dépréciation</th><th className="right">Net</th><th>Action</th></tr></thead><tbody>
          {lines.length?lines.map((line:any)=><tr key={line.id}>
            <td>{line.item_reference}</td><td>{line.description}<div className="muted">{line.unit}</div></td><td>{line.account_code}</td>
            <td className="right">{Number(line.quantity).toLocaleString("fr-FR")}</td><td className="right">{money(Number(line.unit_cost),currency)}</td>
            <td className="right">{money(Number(line.gross_value),currency)}</td><td className="right">{money(Number(line.impairment_amount),currency)}</td><td className="right">{money(Number(line.net_value),currency)}</td>
            <td>{count.status==="draft"&&canManage===true?<FormDialog title="Supprimer une ligne de comptage" buttonLabel="Supprimer" buttonClassName="button"><form action={deleteInventoryCountLine}><input type="hidden" name="line_id" value={line.id}/><button className="button" type="submit">Supprimer</button></form></FormDialog>:"Verrouillée"}</td>
          </tr>):<tr><td colSpan={9}>Aucune ligne. Un inventaire vide peut confirmer un stock nul.</td></tr>}
        </tbody></table>
      </div>

      {count.status==="draft"&&canManage===true&&<FormDialog title="Approuver et verrouiller l'inventaire" buttonLabel="Approuver et verrouiller l'inventaire"><form action={approveInventoryCount} className="form">
        <input type="hidden" name="count_id" value={count.id}/>
        <button className="button primary" type="submit">Approuver et verrouiller l'inventaire</button>
      </form></FormDialog>}
      {count.status==="approved"&&canManage===true&&<FormDialog title="Contrepasser un inventaire" buttonLabel="Contrepasser l'inventaire"><form action={reverseInventoryCount} className="form">
        <input type="hidden" name="count_id" value={count.id}/>
        <div className="field"><label>Motif de contrepassation</label><input name="reason" minLength={10} maxLength={1000} required placeholder="Erreur de comptage, correction d'inventaire..."/></div>
        <button className="button" type="submit">Contrepasser l'inventaire</button>
      </form></FormDialog>}
    </section>}

    <section className="card section">
      <h2>Historique des inventaires</h2>
      {!counts.length?<EmptyState title="Aucun inventaire enregistré" description="Les inventaires brouillons, approuvés et contrepassés apparaîtront ici."/>:
      <div className="tableWrap"><table><thead><tr><th>Date</th><th>Exercice</th><th>Méthode</th><th>Statut</th><th>Créé le</th><th>Approbation</th><th>Action</th></tr></thead><tbody>
        {counts.map((c:any)=><tr key={c.id}><td>{c.count_date}</td><td>{years.find((y:any)=>y.id===c.fiscal_year_id)?.label||"—"}</td><td>{c.valuation_method}</td><td>{c.status}</td><td>{new Date(c.created_at).toLocaleDateString("fr-FR")}</td><td>{c.approved_at?new Date(c.approved_at).toLocaleDateString("fr-FR"):"—"}</td><td><a href={"/inventaires?count="+c.id}>Consulter</a></td></tr>)}
      </tbody></table></div>}
    </section>
  </>;
}
