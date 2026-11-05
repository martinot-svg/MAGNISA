import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";

export type StatementLine = { code: string; label: string; debit: number; credit: number; balance: number };
export type FiscalStatements = {
  organization: any; year: any; currency: string; accounts: any[];
  assets: StatementLine[]; liabilities: StatementLine[]; equity: StatementLine[];
  expenses: StatementLine[]; income: StatementLine[];
  equityChanges: {code:string;label:string;opening:number;increase:number;decrease:number;closing:number}[];
  cashFlows: {label:string;amount:number}[];
  openingCash:number; closingCash:number; profit:number;
  totals: {assets:number;liabilities:number;equity:number;balanceDifference:number};
  controls: {unmapped:number;unbalancedEntries:number;isClosed:boolean;notesReady:boolean;ready:boolean};
  notes: string[];
};

const n=(v:any)=>Number(v||0);
const round=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const cashCodes=/^(511|512|513|514|515|516|517|518|53|54|58)/;

export async function loadFiscalStatements(ctx:any, yearId:string):Promise<FiscalStatements>{
  await requirePermission(ctx,"accounting.view");
  const {supabase,organizationId}=ctx;
  const [{data:year,error:yearError},{data:org,error:orgError},{data:settings},{data:accounts,error:accountError}] = await Promise.all([
    supabase.from("accounting_fiscal_years").select("*").eq("organization_id",organizationId).eq("id",yearId).maybeSingle(),
    supabase.from("organizations").select("name,currency").eq("id",organizationId).single(),
    supabase.from("company_settings").select("trade_name,legal_name,address,tax_id,stat_id,registry_id").eq("organization_id",organizationId).maybeSingle(),
    supabase.from("pcg2005_accounts").select("code,label,kind").order("code"),
  ]);
  if(yearError||orgError||accountError)throw new Error(yearError?.message||orgError?.message||accountError?.message);
  if(!year)throw new Error("Exercice comptable introuvable.");
  const lines:any[]=[];
  for(let from=0;;from+=1000){
    const {data,error}=await supabase.from("pcg2005_journal_lines")
      .select("journal_entry_id,entry_date,reference,status,source_type,line_id,account_key,account_label,debit,credit,pcg_code,mapping_status")
      .eq("organization_id",organizationId).eq("status","posted")
      .gte("entry_date",year.period_start).lte("entry_date",year.period_end)
      .order("entry_date").order("line_id").range(from,from+999);
    if(error)throw new Error(error.message);
    lines.push(...(data||[]));
    if(!data||data.length<1000)break;
  }
  const accountMap=new Map((accounts||[]).map((a:any)=>[a.code,a]));
  const aggregate=new Map<string,{debit:number;credit:number;kind:string;label:string}>();
  let unmapped=0;
  for(const l of lines){
    if(!l.pcg_code||l.mapping_status==="a_mapper"){unmapped++;continue;}
    const a:any=accountMap.get(l.pcg_code);
    if(!a){unmapped++;continue;}
    const v=aggregate.get(l.pcg_code)||{debit:0,credit:0,kind:a.kind,label:a.label};
    v.debit+=n(l.debit);v.credit+=n(l.credit);aggregate.set(l.pcg_code,v);
  }
  const make=(kind:string)=>[...aggregate.entries()].filter(([,v])=>v.kind===kind)
    .map(([code,v])=>({code,label:v.label,debit:round(v.debit),credit:round(v.credit),
      balance:round(kind==="asset"||kind==="expense"?v.debit-v.credit:v.credit-v.debit)}))
    .filter(x=>Math.abs(x.balance)>=0.005).sort((a,b)=>a.code.localeCompare(b.code));
  const assets=make("asset"),liabilities=make("liability"),equity=make("equity");
  const expenses=make("expense"),income=make("income");
  const sum=(xs:StatementLine[])=>round(xs.reduce((s,x)=>s+x.balance,0));
  const totalAssets=sum(assets),totalLiabilities=sum(liabilities),totalEquity=sum(equity);
  const profit=round(sum(income)-sum(expenses));
  const balanceDifference=round(totalAssets-totalLiabilities-totalEquity-(year.status==="closed"?0:profit));
  const equityCodes=new Set<string>((accounts||[]).filter((a:any)=>a.kind==="equity").map((a:any)=>String(a.code)));
  const equityChanges=[...equityCodes].map(code=>{
    const a:any=accountMap.get(code);
    const relevant=lines.filter(l=>l.pcg_code===code);
    const opening=round(relevant.filter(l=>l.source_type==="fiscal_year_opening").reduce((s,l)=>s+n(l.credit)-n(l.debit),0));
    const movement=round(relevant.filter(l=>l.source_type!=="fiscal_year_opening").reduce((s,l)=>s+n(l.credit)-n(l.debit),0));
    const increase=Math.max(movement,0),decrease=Math.max(-movement,0);
    return {code,label:a?.label||code,opening,increase,decrease,closing:round(opening+movement)};
  }).filter(x=>Math.abs(x.opening)+Math.abs(x.increase)+Math.abs(x.decrease)>0.005).sort((a,b)=>a.code.localeCompare(b.code));

  const byEntry=new Map<string,any[]>();
  for(const l of lines){const a=byEntry.get(l.journal_entry_id)||[];a.push(l);byEntry.set(l.journal_entry_id,a);}
  const flows={operating:0,investing:0,financing:0};
  let openingCash=0,closingCash=0;
  for(const l of lines){if(l.pcg_code&&cashCodes.test(l.pcg_code)){const v=n(l.debit)-n(l.credit);closingCash+=v;if(l.source_type==="fiscal_year_opening")openingCash+=v;}}
  for(const entryLines of byEntry.values()){
    const cash=entryLines.filter(l=>l.pcg_code&&cashCodes.test(l.pcg_code));
    const net=cash.reduce((s,l)=>s+n(l.debit)-n(l.credit),0);
    if(Math.abs(net)<0.005||cash.some(l=>l.source_type==="fiscal_year_opening"))continue;
    const counterparts=entryLines.filter(l=>!cashCodes.test(l.pcg_code||"")&&l.pcg_code);
    const weights={operating:0,investing:0,financing:0};
    for(const l of counterparts){
      const klass=(l.pcg_code||"")[0];
      const bucket=klass==="2"?"investing":klass==="1"?"financing":"operating";
      weights[bucket]+=n(l.debit)+n(l.credit);
    }
    const total=weights.operating+weights.investing+weights.financing;
    if(total>0){for(const k of Object.keys(flows) as (keyof typeof flows)[]){flows[k]+=net*weights[k]/total;}}
    else flows.operating+=net;
  }
  const cashFlows=[
    {label:"Flux nets liés aux activités opérationnelles",amount:round(flows.operating)},
    {label:"Flux nets liés aux activités d'investissement",amount:round(flows.investing)},
    {label:"Flux nets liés aux activités de financement",amount:round(flows.financing)},
    {label:"Variation nette de trésorerie",amount:round(flows.operating+flows.investing+flows.financing)},
  ];
  const {data:integrity,error:integrityError}=await supabase.from("pcg2005_journal_integrity")
    .select("id,integrity_status").eq("organization_id",organizationId)
    .gte("entry_date",year.period_start).lte("entry_date",year.period_end);
  if(integrityError)throw new Error(integrityError.message);
  const unbalancedEntries=(integrity||[]).filter((x:any)=>x.integrity_status!=="equilibree").length;
  const noteLabels:Record<string,string>={
    accounting_policies:"Règles et méthodes comptables",
    valuation_methods:"Méthodes d'évaluation et estimations",
    fixed_assets:"Immobilisations, amortissements et dépréciations",
    inventories:"Stocks et en-cours",
    receivables_payables:"Échéances des créances et dettes",
    commitments:"Engagements hors bilan",
    contingencies:"Passifs éventuels et litiges",
    related_parties:"Parties liées et opérations avec dirigeants",
    subsequent_events:"Événements postérieurs à la clôture",
  };
  const noteValues=(year.notes||{}) as Record<string,string>;
  const notesReady=Object.keys(noteLabels).every(k=>String(noteValues[k]||"").trim().length>0);
  const ready=year.status==="closed"&&unmapped===0&&unbalancedEntries===0&&Math.abs(balanceDifference)<0.01&&notesReady;
  const notes=[
    "Référentiel comptable : Plan Comptable Général 2005 de Madagascar.",
    "Devise de présentation : "+(org?.currency||"MGA")+".",
    "Période : "+year.period_start+" au "+year.period_end+".",
    "Base de préparation : écritures comptables validées et imputées au PCG.",
    ...Object.entries(noteLabels).map(([k,label])=>label+" : "+(String(noteValues[k]||"").trim()||"À renseigner avant arrêté définitif.")),
    "Le tableau des flux classe les mouvements de trésorerie à partir des comptes de contrepartie PCG ; les opérations multi-comptes sont ventilées au prorata des montants des contreparties.",
  ];
  return {organization:{...org,...settings},year,currency:org?.currency||"MGA",accounts:accounts||[],
    assets,liabilities,equity,expenses,income,equityChanges,cashFlows,
    openingCash:round(openingCash),closingCash:round(closingCash),profit,
    totals:{assets:totalAssets,liabilities:totalLiabilities,equity:totalEquity,balanceDifference},
    controls:{unmapped,unbalancedEntries,isClosed:year.status==="closed",notesReady,ready},notes};
}

export async function getFiscalStatementContext(yearId:string){
  const ctx=await requireOrganization();
  return {ctx,statements:await loadFiscalStatements(ctx,yearId)};
}
