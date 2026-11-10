import { requireOrganization } from "@/lib/current-org";
import { requirePermission } from "@/lib/permissions";
import { buildAssetPresentation, buildPassifPresentation, classifyReceivableMaturity, matchesStatementAccountKind, type AssetPresentation, type BalanceSheetLedgerLine, type BalanceSheetRule, type PassifPresentation, type PassifRule } from "./balance-sheet-presentation";

export type StatementLine = { code: string; label: string; debit: number; credit: number; balance: number; comparativeBalance: number };
export type FiscalStatements = {
  organization: any; year: any; currency: string; accounts: any[];
  assets: StatementLine[]; liabilities: StatementLine[]; equity: StatementLine[];
  expenses: StatementLine[]; income: StatementLine[];
  equityChanges: {code:string;label:string;opening:number;increase:number;decrease:number;closing:number}[];
  cashFlows: {label:string;amount:number}[];
  openingCash:number; closingCash:number; profit:number; priorYearLabel:string|null;
  totals: {assets:number;liabilities:number;equity:number;balanceDifference:number};
  assetPresentation: AssetPresentation;
  passifPresentation: PassifPresentation;
  cashReconciliation: any;
  inventoryValuation: any;
  controls: {unmapped:number;unbalancedEntries:number;unclassifiedCashFlowEntries:number;cashFlowReconciliationDifference:number;operatingCashFlowReconciliationReady:boolean;pcgPresentationReady:boolean;assetPresentationReady:boolean;passifPresentationReady:boolean;cashReconciliationReady:boolean;inventoryCountReady:boolean;isClosed:boolean;notesReady:boolean;ready:boolean};
  notes: string[];
};

export type FiscalStatementReadinessInput = {
  isClosed: boolean;
  unmapped: number;
  unbalancedEntries: number;
  unclassifiedCashFlowEntries: number;
  cashFlowReconciliationDifference: number;
  balanceDifference: number;
  notesReady: boolean;
  operatingCashFlowReconciliationReady: boolean;
  pcgPresentationReady: boolean;
};

export function isFiscalStatementReady(input: FiscalStatementReadinessInput): boolean {
  return input.isClosed
    && input.unmapped === 0
    && input.unbalancedEntries === 0
    && input.unclassifiedCashFlowEntries === 0
    && Math.abs(input.cashFlowReconciliationDifference) < 0.01
    && Math.abs(input.balanceDifference) < 0.01
    && input.notesReady
    && input.operatingCashFlowReconciliationReady
    && input.pcgPresentationReady;
}

const n=(v:any)=>Number(v||0);
const round=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const cashCodes=/^(511|512|513|514|515|517|518|53|54|58)/;

export function classifyCashFlowCounterpart(code:string):"operating"|"investing"|"financing"|null {
  if(/^(2|404|405|462)/.test(code))return "investing";
  if(/^(10|11|12|13|14|15|16|17|516)/.test(code))return "financing";
  if(/^(3|4|6|7)/.test(code))return "operating";
  return null;
}

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
  const {data:balanceSheetRules,error:balanceSheetRulesError}=await supabase.from("pcg2005_balance_sheet_rules")
    .select("account_code,section,line_key,normal_side,requires_maturity,contra_asset").order("account_code");
  const balanceSheetRulesAvailable=!balanceSheetRulesError;
  const {data:passifRules,error:passifRulesError}=await supabase.from("pcg2005_balance_sheet_passif_rules")
    .select("account_code,section,line_key,normal_side,requires_maturity,contra_equity").order("account_code");
  const passifRulesAvailable=!passifRulesError;
  const {data:cashReconciliationData,error:cashReconciliationError}=await supabase.rpc("get_accounting_cash_reconciliation",{
    p_organization_id:organizationId,
    p_period_end:year.period_end,
  });
  const cashReconciliationAvailable=!cashReconciliationError;
  const {data:inventoryData,error:inventoryError}=await supabase.rpc("get_accounting_inventory_valuation",{
    p_organization_id:organizationId,
    p_period_end:year.period_end,
  });
  const inventoryValuation=(inventoryData||{
    count_available:false,lines:[],gross_ledger_gap:0,impairment_ledger_gap:0,
    gross_gaps:[],impairment_gaps:[],
  }) as any;
  const hasApprovedInventoryCount=!inventoryError&&inventoryValuation.count_available===true;
  const inventoryCountReady=hasApprovedInventoryCount
    &&n(inventoryValuation.gross_ledger_gap)<0.01
    &&n(inventoryValuation.impairment_ledger_gap)<0.01;
  const cashReconciliation=(cashReconciliationData||{
    accounts:[],comparisons:[],account_movement_gap:0,gl_reconciliation_gap:0,
    unknown_account_count:0,unknown_current_balance:0,
  }) as any;
  const {data:fixedAssetReconciliation,error:fixedAssetReconciliationError}=await supabase
    .from("fixed_asset_register_reconciliation")
    .select("account_code,register_debit,register_credit,ledger_debit,ledger_credit,debit_difference,credit_difference,reconciliation_status")
    .eq("organization_id",organizationId);
  if(fixedAssetReconciliationError)throw new Error(fixedAssetReconciliationError.message);
  const {data:receivableData,error:receivableError}=await supabase.rpc("get_accounting_receivable_maturity",{
    p_organization_id:organizationId,
    p_period_end:year.period_end,
  });
  if(receivableError)throw new Error(receivableError.message);
  const invoiceRows=Array.isArray(receivableData?.invoices)?receivableData.invoices:[];
  const invoicePaymentIntegrityGap=n(receivableData?.invoice_payment_integrity_gap);
  const paymentsMissingDateAmount=n(receivableData?.payments_missing_date_amount);
  const unallocatedCustomerPaymentsAmount=n(receivableData?.unallocated_customer_payments_amount);
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
  const {data:priorYear,error:priorYearError}=await supabase.from("accounting_fiscal_years")
    .select("id,label,period_start,period_end,status").eq("organization_id",organizationId)
    .lt("period_end",year.period_start).order("period_end",{ascending:false}).limit(1).maybeSingle();
  if(priorYearError)throw new Error(priorYearError.message);
  const priorLines:any[]=[];
  if(priorYear){
    for(let from=0;;from+=1000){
      const {data,error}=await supabase.from("pcg2005_journal_lines")
        .select("debit,credit,pcg_code,mapping_status,status,source_type")
        .eq("organization_id",organizationId).eq("status","posted")
        .gte("entry_date",priorYear.period_start).lte("entry_date",priorYear.period_end)
        .order("line_id").range(from,from+999);
      if(error)throw new Error(error.message);
      priorLines.push(...(data||[]));
      if(!data||data.length<1000)break;
    }
  }
  const priorBalances=new Map<string,{debit:number;credit:number}>();
  for(const l of priorLines){
    if(!l.pcg_code||l.mapping_status==="a_mapper")continue;
    if(l.source_type==="fiscal_year_closing"&&/^[67]/.test(l.pcg_code))continue;
    const v=priorBalances.get(l.pcg_code)||{debit:0,credit:0};
    v.debit+=n(l.debit);v.credit+=n(l.credit);priorBalances.set(l.pcg_code,v);
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
  const make=(kind:string,source=aggregate)=>[...new Set([...source.keys(),...priorBalances.keys()])]
    .map(code=>{
      const current=source.get(code);
      const account:any=accountMap.get(code);
      if(!account||!matchesStatementAccountKind(code,String(account.kind),kind))return null;
      const v=current||{debit:0,credit:0,kind,label:account.label};
      const prior=priorBalances.get(code)||{debit:0,credit:0};
      const debitNormal=kind==="asset"||kind==="expense"||kind==="clearing";
      return {code,label:v.label,debit:round(v.debit),credit:round(v.credit),
        balance:round(debitNormal?v.debit-v.credit:v.credit-v.debit),
        comparativeBalance:round(debitNormal?prior.debit-prior.credit:prior.credit-prior.debit)};
    })
    .filter((x):x is NonNullable<typeof x>=>!!x&&(Math.abs(x.balance)>=0.005||Math.abs(x.comparativeBalance)>=0.005))
    .sort((a,b)=>a.code.localeCompare(b.code));
  const clearing=make("clearing");
  const assets=[...make("asset"),...clearing.filter(x=>x.balance>0)];
  let invoiceSubledgerBalance=0;
  const receivableLines:BalanceSheetLedgerLine[]=(invoiceRows||[]).flatMap((invoice:any)=>{
    const outstanding=round(n(invoice.outstanding_amount));
    invoiceSubledgerBalance=round(invoiceSubledgerBalance+outstanding);
    if(Math.abs(outstanding)<0.005)return [];
    const maturity=classifyReceivableMaturity(invoice.due_date?String(invoice.due_date):null,String(year.period_end));
    return [{
      code:"411",
      label:"Client • "+String(invoice.number||invoice.id),
      debit:Math.max(outstanding,0),
      credit:Math.max(-outstanding,0),
      balance:outstanding,
      maturity,
    }];
  });
  const ledgerReceivablesBalance=assets.find(x=>x.code==="411")?.balance||0;
  const receivableLedgerGap=round(ledgerReceivablesBalance-invoiceSubledgerBalance);
  const fixedAssetGapRows=(fixedAssetReconciliation||[]).filter((row:any)=>
    Math.abs(n(row.debit_difference))+Math.abs(n(row.credit_difference))>=0.01
  );
  const fixedAssetGapRules:BalanceSheetRule[]=fixedAssetGapRows.map((row:any)=>({
    account_code:"__FIXED_ASSET_RECONCILIATION_"+String(row.account_code).replace(/[^A-Za-z0-9]/g,"_")+"__",
    section:"review",line_key:"Écart registre / grand livre immobilisations",normal_side:"both",
    requires_maturity:false,contra_asset:false,
  }));
  const fixedAssetGapLines:BalanceSheetLedgerLine[]=fixedAssetGapRows.map((row:any)=>({
    code:"__FIXED_ASSET_RECONCILIATION_"+String(row.account_code).replace(/[^A-Za-z0-9]/g,"_")+"__",
    label:"Immobilisations • compte "+String(row.account_code)+" • "+String(row.reconciliation_status),
    debit:round(Math.abs(n(row.debit_difference))+Math.abs(n(row.credit_difference))),
    credit:0,
    balance:round(Math.abs(n(row.debit_difference))+Math.abs(n(row.credit_difference))),
  }));
  const cashComparisonGaps=(cashReconciliation.comparisons||[]).filter((row:any)=>Math.abs(n(row.difference))>=0.01);
  const cashMovementGaps=(cashReconciliation.accounts||[]).filter((row:any)=>Math.abs(n(row.movement_gap))>=0.01);
  const cashGapRules:BalanceSheetRule[]=[
    ...cashComparisonGaps.map((row:any)=>({
      account_code:"__CASH_GL_RECONCILIATION_"+String(row.pcg_account_code).replace(/[^A-Za-z0-9]/g,"_")+"__",
      section:"review" as const,line_key:"Écart trésorerie auxiliaire / grand livre",normal_side:"both" as const,
      requires_maturity:false,contra_asset:false,
    })),
    ...cashMovementGaps.map((row:any)=>({
      account_code:"__CASH_MOVEMENT_RECONCILIATION_"+String(row.id).replace(/[^A-Za-z0-9]/g,"_")+"__",
      section:"review" as const,line_key:"Écart compte financier / mouvements",normal_side:"both" as const,
      requires_maturity:false,contra_asset:false,
    })),
  ];
  const cashGapLines:BalanceSheetLedgerLine[]=[
    ...cashComparisonGaps.map((row:any)=>({
      code:"__CASH_GL_RECONCILIATION_"+String(row.pcg_account_code).replace(/[^A-Za-z0-9]/g,"_")+"__",
      label:"Trésorerie • compte PCG "+String(row.pcg_account_code)+" • écart auxiliaire / GL",
      debit:Math.abs(n(row.difference)),credit:0,balance:Math.abs(n(row.difference)),
    })),
    ...cashMovementGaps.map((row:any)=>({
      code:"__CASH_MOVEMENT_RECONCILIATION_"+String(row.id).replace(/[^A-Za-z0-9]/g,"_")+"__",
      label:"Trésorerie • "+String(row.name)+" • écart mouvements",
      debit:Math.abs(n(row.movement_gap)),credit:0,balance:Math.abs(n(row.movement_gap)),
    })),
  ];
  const cashBlockingIssues:string[]=[];
  if(!cashReconciliationAvailable)cashBlockingIssues.push("Rapprochement de trésorerie indisponible : RPC ou migration PCG manquante.");
  if(inventoryError)cashBlockingIssues.push("Sous-grand-livre d’inventaire indisponible : migration ou RPC manquante.");
  else if(!hasApprovedInventoryCount)cashBlockingIssues.push("Inventaire physique approuvé manquant à la date de clôture : les stocks ne peuvent pas être validés.");
  if(hasApprovedInventoryCount&&n(inventoryValuation.gross_ledger_gap)>=0.01)cashBlockingIssues.push("La valeur brute de l’inventaire physique ne correspond pas aux comptes de stocks du grand livre.");
  if(hasApprovedInventoryCount&&n(inventoryValuation.impairment_ledger_gap)>=0.01)cashBlockingIssues.push("Les dépréciations d’inventaire ne correspondent pas aux comptes 39 du grand livre.");
  if(n(cashReconciliation.unknown_account_count)>0)cashBlockingIssues.push(String(cashReconciliation.unknown_account_count)+" compte(s) financier(s) sans correspondance PCG 5.");
  if(n(cashReconciliation.account_movement_gap)>=0.01)cashBlockingIssues.push("Les soldes des comptes financiers ne correspondent pas à leurs mouvements.");
  if(n(cashReconciliation.gl_reconciliation_gap)>=0.01)cashBlockingIssues.push("Les soldes de trésorerie auxiliaires ne correspondent pas au grand livre.");
  const cashReconciliationReady=cashReconciliationAvailable
    &&n(cashReconciliation.unknown_account_count)===0
    &&n(cashReconciliation.account_movement_gap)<0.01
    &&n(cashReconciliation.gl_reconciliation_gap)<0.01;
  const inventoryGapRows=[
    ...(inventoryValuation.gross_gaps||[]).map((row:any)=>({...row,gap_type:"valeur brute"})),
    ...(inventoryValuation.impairment_gaps||[]).map((row:any)=>({...row,gap_type:"dépréciation"})),
  ].filter((row:any)=>Math.abs(n(row.difference))>=0.01);
  const inventoryGapRules:BalanceSheetRule[]=inventoryGapRows.map((row:any)=>({
    account_code:"__INVENTORY_RECONCILIATION_"+String(row.gap_type).replace(/[^A-Za-z0-9]/g,"_")+"_"+String(row.account_code).replace(/[^A-Za-z0-9]/g,"_")+"__",
    section:"review",line_key:"Écart inventaire physique / grand livre",normal_side:"both",
    requires_maturity:false,contra_asset:false,
  }));
  const inventoryGapLines:BalanceSheetLedgerLine[]=inventoryGapRows.map((row:any)=>({
    code:"__INVENTORY_RECONCILIATION_"+String(row.gap_type).replace(/[^A-Za-z0-9]/g,"_")+"_"+String(row.account_code).replace(/[^A-Za-z0-9]/g,"_")+"__",
    label:"Inventaire • "+row.gap_type+" • compte "+row.account_code,
    debit:Math.abs(n(row.difference)),credit:0,balance:Math.abs(n(row.difference)),
  }));
  const stockLedgerLines=assets.filter(x=>/^3/.test(x.code));
  const stockPresentationLines:BalanceSheetLedgerLine[]=hasApprovedInventoryCount
    ? (inventoryValuation.lines||[]).flatMap((item:any)=>[
        {code:String(item.account_code),label:"Stock • "+String(item.item_reference)+" • "+String(item.description),debit:n(item.gross_value),credit:0,balance:n(item.gross_value)},
        ...(n(item.impairment_amount)>0&&item.impairment_account_code?[{
          code:String(item.impairment_account_code),label:"Dépréciation stock • "+String(item.item_reference)+" • "+String(item.description),
          debit:0,credit:n(item.impairment_amount),balance:-n(item.impairment_amount),
        }]:[]),
      ])
    : stockLedgerLines;
  const stockRules:BalanceSheetRule[]=hasApprovedInventoryCount?[]:stockLedgerLines.map((line:any)=>({
    account_code:line.code,section:"review",line_key:"Stocks sans inventaire physique approuvé",
    normal_side:"both",requires_maturity:false,contra_asset:false,
  }));
  const reconciliationRules:BalanceSheetRule[]=[
    ...inventoryGapRules,
    ...stockRules,
    ...cashGapRules,
    ...fixedAssetGapRules,
    {account_code:"__AR_GL_RECONCILIATION__",section:"review",line_key:"Écart grand livre / auxiliaire clients",normal_side:"both",requires_maturity:false,contra_asset:false},
    {account_code:"__AR_PAYMENT_RECONCILIATION__",section:"review",line_key:"Écart factures / règlements",normal_side:"both",requires_maturity:false,contra_asset:false},
    {account_code:"__AR_PAYMENT_DATE_MISSING__",section:"review",line_key:"Règlements confirmés sans date",normal_side:"both",requires_maturity:false,contra_asset:false},
    {account_code:"__AR_UNALLOCATED_PAYMENT__",section:"review",line_key:"Règlements clients non affectés",normal_side:"both",requires_maturity:false,contra_asset:false},
  ];
  const reconciliationLines:BalanceSheetLedgerLine[]=[
    ...(Math.abs(receivableLedgerGap)>=0.01?[{code:"__AR_GL_RECONCILIATION__",label:"Écart de rapprochement du compte 411",debit:Math.max(receivableLedgerGap,0),credit:Math.max(-receivableLedgerGap,0),balance:receivableLedgerGap}]:[]),
    ...(invoicePaymentIntegrityGap>=0.01?[{code:"__AR_PAYMENT_RECONCILIATION__",label:"Écart absolu factures / règlements",debit:round(invoicePaymentIntegrityGap),credit:0,balance:round(invoicePaymentIntegrityGap)}]:[]),
    ...(paymentsMissingDateAmount>=0.01?[{code:"__AR_PAYMENT_DATE_MISSING__",label:"Règlements confirmés sans date",debit:round(paymentsMissingDateAmount),credit:0,balance:round(paymentsMissingDateAmount)}]:[]),
    ...(unallocatedCustomerPaymentsAmount>=0.01?[{code:"__AR_UNALLOCATED_PAYMENT__",label:"Règlements clients non affectés",debit:round(unallocatedCustomerPaymentsAmount),credit:0,balance:round(unallocatedCustomerPaymentsAmount)}]:[]),
  ];
  const presentationLines:BalanceSheetLedgerLine[]=[
    ...assets.filter(x=>x.code!=="411"&&!/^3/.test(x.code)),
    ...receivableLines,
    ...stockPresentationLines,
    ...fixedAssetGapLines,
    ...inventoryGapLines,
    ...cashGapLines,
    ...reconciliationLines,
  ];
  const assetPresentation=buildAssetPresentation(presentationLines,[...(balanceSheetRules||[]),...reconciliationRules],cashBlockingIssues);
  const assetPresentationReady=balanceSheetRulesAvailable&&assetPresentation.ready&&unmapped===0&&cashReconciliationReady&&inventoryCountReady;
  const liabilities=[...make("liability"),...clearing.filter(x=>x.balance<0).map(x=>({...x,balance:-x.balance,comparativeBalance:-x.comparativeBalance}))];
  const equity=make("equity");
  const resultAggregate=new Map<string,{debit:number;credit:number;kind:string;label:string}>();
  for(const l of lines){
    if(l.source_type==="fiscal_year_closing"||!l.pcg_code)continue;
    const a:any=accountMap.get(l.pcg_code);
    if(!a||!["expense","income"].includes(a.kind))continue;
    const v=resultAggregate.get(l.pcg_code)||{debit:0,credit:0,kind:a.kind,label:a.label};
    v.debit+=n(l.debit);v.credit+=n(l.credit);resultAggregate.set(l.pcg_code,v);
  }
  const expenses=make("expense",resultAggregate),income=make("income",resultAggregate);
  const sum=(xs:StatementLine[])=>round(xs.reduce((s,x)=>s+x.balance,0));
  const totalAssets=sum(assets),totalLiabilities=sum(liabilities),totalEquity=sum(equity);
  const profit=round(sum(income)-sum(expenses));
  const currentResultAlreadyPosted=equity.some((line:any)=>
    (line.code==="120"||line.code==="129")&&Math.abs(line.balance)>=0.005
  );
  const includeCurrentYearResult=year.status!=="closed"&&!currentResultAlreadyPosted;

  const passifBlockingIssues:string[]=[];
  if(!passifRulesAvailable)passifBlockingIssues.push("Référentiel de présentation du passif PCG 2005 indisponible.");

  // Supplier payables are reconstructed as of the fiscal closing date.
  const supplierPassifLines:BalanceSheetLedgerLine[]=[];
  const supplierPassifRules:PassifRule[]=[];
  const supplierAccountCodes=new Set<string>();
  const {data:supplierInvoices,error:supplierInvoicesError}=await supabase.from("supplier_invoices")
    .select("id,supplier_number,invoice_date,due_date,status,total")
    .eq("organization_id",organizationId).lte("invoice_date",year.period_end);
  const {data:supplierPayments,error:supplierPaymentsError}=await supabase.from("supplier_payments")
    .select("supplier_invoice_id,amount,payment_date")
    .eq("organization_id",organizationId).lte("payment_date",year.period_end);
  const {data:supplierReconRows,error:supplierReconError}=await supabase.from("magnisa_supplier_reconciliation")
    .select("supplier_invoice_id,payment_difference,allocation_difference,reconciliation_status")
    .eq("organization_id",organizationId);
  if(supplierInvoicesError||supplierPaymentsError||supplierReconError){
    passifBlockingIssues.push("Rapprochement des dettes fournisseurs indisponible : "+(supplierInvoicesError?.message||supplierPaymentsError?.message||supplierReconError?.message));
  }else{
    const supplierPaymentsByInvoice=new Map<string,number>();
    for(const payment of supplierPayments||[]){
      supplierPaymentsByInvoice.set(payment.supplier_invoice_id,round((supplierPaymentsByInvoice.get(payment.supplier_invoice_id)||0)+n(payment.amount)));
    }
    const supplierReconMap=new Map((supplierReconRows||[]).map((row:any)=>[row.supplier_invoice_id,row]));
    let supplierSubledgerBalance=0;
    const activeSupplierInvoices=(supplierInvoices||[]).filter((invoice:any)=>{
      const status=String(invoice.status||"").toLowerCase();
      if(["draft","cancelled","canceled","void","annulee","annulée"].includes(status)){
        if(["cancelled","canceled","void","annulee","annulée"].includes(status)){
          passifBlockingIssues.push("Facture fournisseur "+String(invoice.supplier_number||invoice.id)+" annulée sans date d’effet historique exploitable.");
        }
        return false;
      }
      return true;
    });
    for(const invoice of activeSupplierInvoices){
      const reconciliation:any=supplierReconMap.get(invoice.id);
      if(!reconciliation){
        passifBlockingIssues.push("Facture fournisseur "+String(invoice.supplier_number||invoice.id)+" absente du rapprochement auxiliaire.");
      }else if(reconciliation.reconciliation_status!=="ok"||Math.abs(n(reconciliation.payment_difference))>=0.01||Math.abs(n(reconciliation.allocation_difference))>=0.01){
        passifBlockingIssues.push("Rapprochement paiement / facture à corriger pour le fournisseur "+String(invoice.supplier_number||invoice.id)+".");
      }
      const paidAtClosing=supplierPaymentsByInvoice.get(invoice.id)||0;
      const balance=round(n(invoice.total)-paidAtClosing);
      supplierSubledgerBalance=round(supplierSubledgerBalance+balance);
      if(balance < -0.005){
        const code="__SUPPLIER_CREDIT_BALANCE_"+String(invoice.id).replace(/[^A-Za-z0-9]/g,"_")+"__";
        supplierPassifLines.push({code,label:"Avance ou solde créditeur fournisseur • "+String(invoice.supplier_number||invoice.id),debit:Math.abs(balance),credit:0,balance:Math.abs(balance)});
        supplierPassifRules.push({account_code:code,section:"review",line_key:"supplier_credit_balance_to_reclassify",normal_side:"both",requires_maturity:false,contra_equity:false});
        passifBlockingIssues.push("Solde créditeur fournisseur à reclasser vers les avances versées (PCG 409) : "+String(invoice.supplier_number||invoice.id)+".");
      }else if(balance>=0.005){
        const maturity=classifyReceivableMaturity(invoice.due_date?String(invoice.due_date):null,String(year.period_end));
        supplierPassifLines.push({
          code:"401",label:"Fournisseur • "+String(invoice.supplier_number||invoice.id),
          debit:0,credit:balance,balance,
          ...(maturity?{maturity}:{}),
        });
      }
    }
    if(activeSupplierInvoices.length)supplierAccountCodes.add("401");
    const supplierLedgerBalance=liabilities.find((line:any)=>line.code==="401")?.balance||0;
    const supplierGap=round(supplierLedgerBalance-supplierSubledgerBalance);
    if(Math.abs(supplierGap)>=0.01){
      const code="__SUPPLIER_RECONCILIATION__";
      supplierPassifLines.push({code,label:"Écart dettes fournisseurs auxiliaire / grand livre",debit:Math.abs(supplierGap),credit:0,balance:Math.abs(supplierGap)});
      supplierPassifRules.push({account_code:code,section:"review",line_key:"supplier_payables_reconciliation",normal_side:"both",requires_maturity:false,contra_equity:false});
      passifBlockingIssues.push("Les factures fournisseurs au "+String(year.period_end)+" ne correspondent pas au solde PCG 401 : écart de "+supplierGap+" "+(org?.currency||"MGA")+".");
    }
  }

  // Payroll payables are reconstructed from payslips less payments actually made by period end.
  const payrollPassifLines:BalanceSheetLedgerLine[]=[];
  const payrollPassifRules:PassifRule[]=[];
  const payrollAccountCodes=new Set<string>();
  const {data:payrollRuns,error:payrollRunsError}=await supabase.from("payroll_runs")
    .select("id,period_start,period_end,status")
    .eq("organization_id",organizationId).lte("period_start",year.period_end).gte("period_end",year.period_start);
  if(payrollRunsError){
    passifBlockingIssues.push("Rapprochement des dettes de personnel indisponible : "+payrollRunsError.message);
  }else{
    const payrollRunIds=(payrollRuns||[]).filter((run:any)=>!["draft","cancelled","canceled"].includes(String(run.status||"").toLowerCase())).map((run:any)=>run.id);
    let payslipRows:any[]=[];
    let payrollReconRows:any[]=[];
    let payrollPayments:any[]=[];
    if(payrollRunIds.length){
      const [{data:payslipsData,error:payslipsError},{data:payrollReconData,error:payrollReconError},{data:payrollPaymentsData,error:payrollPaymentsError}]=await Promise.all([
        supabase.from("payslips").select("id,payroll_run_id,net_pay,status,magnisa_reference").eq("organization_id",organizationId).in("payroll_run_id",payrollRunIds),
        supabase.from("magnisa_payroll_reconciliation").select("payslip_id,payment_difference,reconciliation_status").eq("organization_id",organizationId),
        supabase.from("payroll_payments").select("payslip_id,amount,payment_date").eq("organization_id",organizationId).lte("payment_date",year.period_end),
      ]);
      if(payslipsError||payrollReconError||payrollPaymentsError)passifBlockingIssues.push("Détail des paies ou rapprochement des paiements indisponible : "+(payslipsError?.message||payrollReconError?.message||payrollPaymentsError?.message));
      else{payslipRows=payslipsData||[];payrollReconRows=payrollReconData||[];payrollPayments=payrollPaymentsData||[];}
    }
    const payrollReconMap=new Map(payrollReconRows.map((row:any)=>[row.payslip_id,row]));
    const payrollPaymentsByPayslip=new Map<string,number>();
    for(const payment of payrollPayments){
      payrollPaymentsByPayslip.set(payment.payslip_id,round((payrollPaymentsByPayslip.get(payment.payslip_id)||0)+n(payment.amount)));
    }
    let payrollSubledgerBalance=0;
    const activePayslips=payslipRows.filter((payslip:any)=>!["draft","cancelled","canceled"].includes(String(payslip.status||"").toLowerCase()));
    for(const payslip of activePayslips){
      const balance=round(n(payslip.net_pay)-(payrollPaymentsByPayslip.get(payslip.id)||0));
      const reconciliation:any=payrollReconMap.get(payslip.id);
      if(!reconciliation||reconciliation.reconciliation_status!=="ok"||Math.abs(n(reconciliation.payment_difference))>=0.01){
        passifBlockingIssues.push("Rapprochement des paiements de paie à corriger pour le bulletin "+String(payslip.magnisa_reference||payslip.id)+".");
      }
      payrollSubledgerBalance=round(payrollSubledgerBalance+balance);
      if(Math.abs(balance)>=0.005){
        payrollPassifLines.push({
          code:"421",label:"Rémunération due • "+String(payslip.magnisa_reference||payslip.id),
          debit:Math.max(-balance,0),credit:Math.max(balance,0),balance,maturity:"current",
        });
      }
    }
    if(activePayslips.length)payrollAccountCodes.add("421");
    const payrollLedgerBalance=liabilities.find((line:any)=>line.code==="421")?.balance||0;
    const payrollGap=round(payrollLedgerBalance-payrollSubledgerBalance);
    if(Math.abs(payrollGap)>=0.01){
      const code="__PAYROLL_RECONCILIATION__";
      payrollPassifLines.push({code,label:"Écart paies dues / compte PCG 421",debit:Math.abs(payrollGap),credit:0,balance:Math.abs(payrollGap)});
      payrollPassifRules.push({account_code:code,section:"review",line_key:"payroll_payables_reconciliation",normal_side:"both",requires_maturity:false,contra_equity:false});
      passifBlockingIssues.push("Les rémunérations dues au "+String(year.period_end)+" ne correspondent pas au solde PCG 421 : écart de "+payrollGap+" "+(org?.currency||"MGA")+".");
    }
  }

  const {data:loanRows,error:loanRowsError}=await supabase.from("loans")
    .select("id,lender_name,magnisa_reference,outstanding_principal,liability_account_code,active_schedule_version_id,status")
    .eq("organization_id",organizationId);
  if(loanRowsError)passifBlockingIssues.push("Échéanciers d’emprunts indisponibles : "+loanRowsError.message);
  const activeScheduleIds=[...new Set((loanRows||[]).map((loan:any)=>loan.active_schedule_version_id).filter(Boolean))] as string[];
  let loanInstallments:any[]=[];
  if(activeScheduleIds.length){
    const {data,error}=await supabase.from("loan_installments")
      .select("loan_id,schedule_version_id,due_date,principal_due,status")
      .eq("organization_id",organizationId).in("schedule_version_id",activeScheduleIds);
    if(error)passifBlockingIssues.push("Détail des échéances d’emprunts indisponible : "+error.message);
    else loanInstallments=data||[];
  }
  const loanScheduleLines:BalanceSheetLedgerLine[]=[];
  const loanScheduleRules:PassifRule[]=[];
  const loanAccountCodes=new Set<string>();
  const scheduledByAccount=new Map<string,number>();
  for(const loan of loanRows||[]){
    const outstanding=Math.max(0,n(loan.outstanding_principal));
    if(outstanding<0.005)continue;
    const accountCode=String(loan.liability_account_code||"");
    if(!accountCode){
      passifBlockingIssues.push("Emprunt "+String(loan.magnisa_reference||loan.id)+" sans compte PCG de dette.");
      continue;
    }
    const scheduleId=String(loan.active_schedule_version_id||"");
    if(!scheduleId){
      passifBlockingIssues.push("Emprunt "+String(loan.magnisa_reference||loan.id)+" sans échéancier approuvé actif.");
      continue;
    }
    const rows=loanInstallments.filter((item:any)=>item.loan_id===loan.id&&item.schedule_version_id===scheduleId&&!["paid","cancelled","canceled","void","reversed"].includes(String(item.status||"").toLowerCase()));
    if(!rows.length){
      passifBlockingIssues.push("Échéancier vide pour l’emprunt "+String(loan.magnisa_reference||loan.id)+".");
      continue;
    }
    let currentPrincipal=0,nonCurrentPrincipal=0,unknownMaturity=0;
    for(const item of rows){
      const amount=Math.max(0,n(item.principal_due));
      if(amount<0.005)continue;
      const maturity=classifyReceivableMaturity(item.due_date?String(item.due_date):null,String(year.period_end));
      if(maturity==="current")currentPrincipal=round(currentPrincipal+amount);
      else if(maturity==="non_current")nonCurrentPrincipal=round(nonCurrentPrincipal+amount);
      else unknownMaturity=round(unknownMaturity+amount);
    }
    const scheduled=round(currentPrincipal+nonCurrentPrincipal+unknownMaturity);
    if(Math.abs(scheduled-outstanding)>=0.01){
      passifBlockingIssues.push("Écart entre le capital restant dû de l’emprunt "+String(loan.magnisa_reference||loan.id)+" et son échéancier : "+round(scheduled-outstanding)+" "+(org?.currency||"MGA")+".");
    }
    loanAccountCodes.add(accountCode);
    scheduledByAccount.set(accountCode,round((scheduledByAccount.get(accountCode)||0)+scheduled));
    const label="Emprunt • "+String(loan.magnisa_reference||loan.lender_name||loan.id);
    if(currentPrincipal>=0.005)loanScheduleLines.push({code:accountCode,label,debit:0,credit:currentPrincipal,balance:currentPrincipal,maturity:"current"});
    if(nonCurrentPrincipal>=0.005)loanScheduleLines.push({code:accountCode,label,debit:0,credit:nonCurrentPrincipal,balance:nonCurrentPrincipal,maturity:"non_current"});
    if(unknownMaturity>=0.005)loanScheduleLines.push({code:accountCode,label,debit:0,credit:unknownMaturity,balance:unknownMaturity});
  }
  const loanGapLines:BalanceSheetLedgerLine[]=[];
  for(const [accountCode,scheduled] of scheduledByAccount){
    const ledger=liabilities.find((line:any)=>line.code===accountCode)?.balance||0;
    const difference=round(ledger-scheduled);
    if(Math.abs(difference)>=0.01){
      const code="__LOAN_RECONCILIATION_"+accountCode.replace(/[^A-Za-z0-9]/g,"_")+"__";
      loanGapLines.push({code,label:"Écart échéancier / grand livre • compte "+accountCode,debit:Math.abs(difference),credit:0,balance:Math.abs(difference)});
      loanScheduleRules.push({account_code:code,section:"review",line_key:"loan_schedule_reconciliation",normal_side:"both",requires_maturity:false,contra_equity:false});
    }
  }
  const currentYearResultLine:BalanceSheetLedgerLine[]=
    includeCurrentYearResult&&Math.abs(profit)>=0.005
      ? [{code:"__CURRENT_YEAR_RESULT__",label:"Résultat de l’exercice",debit:Math.max(-profit,0),credit:Math.max(profit,0),balance:profit}]
      : [];
  const currentYearResultRule:PassifRule[]=[{
    account_code:"__CURRENT_YEAR_RESULT__",section:"equity",line_key:"equity_current_result",
    normal_side:"both",requires_maturity:false,contra_equity:false,
  }];
  const passifLines:BalanceSheetLedgerLine[]=[
    ...equity,
    ...liabilities.filter((line:any)=>!loanAccountCodes.has(line.code)&&!supplierAccountCodes.has(line.code)&&!payrollAccountCodes.has(line.code)),
    ...supplierPassifLines,
    ...payrollPassifLines,
    ...loanScheduleLines,
    ...loanGapLines,
    ...currentYearResultLine,
  ];
  const passifPresentation=buildPassifPresentation(
    passifLines,
    [...(passifRules||[]),...supplierPassifRules,...payrollPassifRules,...loanScheduleRules,...currentYearResultRule],
    passifBlockingIssues,
  );
  const passifPresentationReady=passifRulesAvailable&&passifPresentation.ready
    &&Math.abs(passifPresentation.totals.passif-(totalEquity+totalLiabilities+(includeCurrentYearResult?profit:0)))<0.01;
  const balanceDifference=round(totalAssets-totalLiabilities-totalEquity-(includeCurrentYearResult?profit:0));
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
  const flows={operating:{receipts:0,payments:0},investing:{receipts:0,payments:0},financing:{receipts:0,payments:0}};
  let openingCash=0,closingCash=0,unclassifiedCashFlowEntries=0;
  for(const l of lines){
    if(l.pcg_code&&cashCodes.test(l.pcg_code)){
      const v=n(l.debit)-n(l.credit);closingCash+=v;
      if(l.source_type==="fiscal_year_opening")openingCash+=v;
    }
  }
  for(const entryLines of byEntry.values()){
    const cashLines=entryLines.filter(l=>l.pcg_code&&cashCodes.test(l.pcg_code));
    if(!cashLines.length||cashLines.every(l=>l.source_type==="fiscal_year_opening"))continue;
    const counterparts=entryLines.filter(l=>l.pcg_code&&!cashCodes.test(l.pcg_code||"")&&l.source_type!=="fiscal_year_opening");
    if(cashLines.length!==1||counterparts.length!==1){
      unclassifiedCashFlowEntries++;
      continue;
    }
    const bucket=classifyCashFlowCounterpart(String(counterparts[0].pcg_code));
    if(!bucket){unclassifiedCashFlowEntries++;continue;}
    const amount=n(cashLines[0].debit)-n(cashLines[0].credit);
    if(amount>=0)flows[bucket].receipts+=amount;
    else flows[bucket].payments+=Math.abs(amount);
  }
  const netOperating=round(flows.operating.receipts-flows.operating.payments);
  const netInvesting=round(flows.investing.receipts-flows.investing.payments);
  const netFinancing=round(flows.financing.receipts-flows.financing.payments);
  const cashFlowNet=round(netOperating+netInvesting+netFinancing);
  const cashFlowReconciliationDifference=round((closingCash-openingCash)-cashFlowNet);
  const cashFlows=[
    {label:"Activités opérationnelles • encaissements",amount:round(flows.operating.receipts)},
    {label:"Activités opérationnelles • décaissements",amount:-round(flows.operating.payments)},
    {label:"Flux nets des activités opérationnelles",amount:netOperating},
    {label:"Activités d'investissement • encaissements",amount:round(flows.investing.receipts)},
    {label:"Activités d'investissement • décaissements",amount:-round(flows.investing.payments)},
    {label:"Flux nets des activités d'investissement",amount:netInvesting},
    {label:"Activités de financement • encaissements",amount:round(flows.financing.receipts)},
    {label:"Activités de financement • décaissements",amount:-round(flows.financing.payments)},
    {label:"Flux nets des activités de financement",amount:netFinancing},
    {label:"Variation nette de trésorerie",amount:cashFlowNet},
  ];
  const {data:integrity,error:integrityError}=await supabase.from("pcg2005_journal_integrity")
    .select("id,integrity_status").eq("organization_id",organizationId)
    .gte("entry_date",year.period_start).lte("entry_date",year.period_end);
  if(integrityError)throw new Error(integrityError.message);
  const unbalancedEntries=(integrity||[]).filter((x:any)=>x.integrity_status!=="equilibree").length;
  const assetPresentationControlsReady=assetPresentationReady&&unbalancedEntries===0;
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
  // The current ledger does not yet contain validated cash-flow line-item mappings,
  // a bridge to pre-tax profit, or current/non-current maturity classifications.
  // Never label these statements as finalized until those PCG controls exist.
  const operatingCashFlowReconciliationReady=false;
  const pcgPresentationReady=false;
  const ready=isFiscalStatementReady({isClosed:year.status==="closed",unmapped,unbalancedEntries,unclassifiedCashFlowEntries,cashFlowReconciliationDifference,balanceDifference,notesReady,operatingCashFlowReconciliationReady,pcgPresentationReady});
  const notes=[
    "Référentiel comptable : Plan Comptable Général 2005 de Madagascar.",
    "Devise de présentation : "+(org?.currency||"MGA")+".",
    "Période : "+year.period_start+" au "+year.period_end+".",
    "Base de préparation : écritures comptables validées et imputées au PCG.",
    ...Object.entries(noteLabels).map(([k,label])=>label+" : "+(String(noteValues[k]||"").trim()||"À renseigner avant arrêté définitif.")),
    "Le tableau des flux présente uniquement les mouvements bruts dont la contrepartie est unique. Le rapprochement du flux opérationnel avec le résultat avant impôt, requis par le PCG 2005 article 250-3, reste à construire et empêche l’arrêté définitif.",
    "Les créances clients du compte 411 sont ventilées selon les échéances contractuelles des factures et rapprochées des règlements confirmés et du grand livre. Les autres créances nécessitent leurs justificatifs d’échéance. La présentation réglementaire complète du bilan et du compte de résultat reste à valider."
  ];
  return {organization:{...org,...settings},year,currency:org?.currency||"MGA",accounts:accounts||[],
    assets,liabilities,equity,expenses,income,equityChanges,cashFlows,assetPresentation,passifPresentation,cashReconciliation,inventoryValuation,
    openingCash:round(openingCash),closingCash:round(closingCash),profit,priorYearLabel:priorYear?.label||null,
    totals:{assets:totalAssets,liabilities:totalLiabilities,equity:totalEquity,balanceDifference},
    controls:{unmapped,unbalancedEntries,unclassifiedCashFlowEntries,cashFlowReconciliationDifference,operatingCashFlowReconciliationReady,pcgPresentationReady,assetPresentationReady:assetPresentationControlsReady,passifPresentationReady,cashReconciliationReady,inventoryCountReady,isClosed:year.status==="closed",notesReady,ready},notes};
}

export async function getFiscalStatementContext(yearId:string){
  const ctx=await requireOrganization();
  return {ctx,statements:await loadFiscalStatements(ctx,yearId)};
}
