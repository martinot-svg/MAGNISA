/** MVola public tariffs (MGA TTC), effective 2025-02-17.
 * Source: https://mvola.mg/tarifs/
 * Documented: docs/referentiel-tarifs-mvola-2025.md
 * Estimates only: never create financial movements or expenses from these rates.
 */
export const MVOLA_RATE_VERSION = "2025-02-17";
export type MvolaFeeOperation = "withdrawal"|"transfer_mvola"|"transfer_other_operator"|"transfer_non_subscriber"|"deposit"|"enterprise_transfer"|"merchant_payment"|"bank_to_bni"|"bank_other";
type Band=[number,number,number|null];
const withdrawal:Band[]=[[100,1000,100],[1001,5000,150],[5001,10000,275],[10001,20000,550],[20001,25000,650],[25001,50000,1300],[50001,100000,1900],[100001,250000,3400],[250001,500000,4700],[500001,1000000,8800],[1000001,2000000,14700],[2000001,3000000,19600],[3000001,4000000,24500],[4000001,5000000,29400],[5000001,6000000,34300],[6000001,7000000,39200],[7000001,8000000,44100],[8000001,9000000,49000],[9000001,10000000,53900],[10000001,11000000,59000],[11000001,12000000,64000],[12000001,13000000,69000],[13000001,14000000,74000],[14000001,15000000,79000],[15000001,16000000,84000],[16000001,17000000,89000],[17000001,18000000,94000],[18000001,19000000,98000],[19000001,20000000,100000]];
const transfer: Array<[number,number,number|null,number|null,number|null]>=[[100,1000,70,200,750],[1001,5000,70,250,750],[5001,10000,150,500,1400],[10001,25000,250,1000,1800],[25001,50000,500,1500,3800],[50001,100000,1000,2000,4800],[100001,250000,1900,3500,10000],[250001,500000,1900,5000,15000],[500001,1000000,3200,8500,20000],[1000001,2000000,3800,12000,30000],[2000001,3000000,5000,14500,40000],[3000001,4000000,6300,19500,50000],[4000001,5000000,7500,24000,60000],[5000001,6000000,9400,null,null],[6000001,7000000,10700,null,null],[7000001,8000000,12500,null,null],[8000001,9000000,14400,null,null],[9000001,10000000,15700,null,null],[10000001,11000000,17500,null,null],[11000001,12000000,18800,null,null],[12000001,13000000,20000,null,null],[13000001,14000000,21300,null,null],[14000001,15000000,23200,null,null],[15000001,16000000,25000,null,null],[16000001,17000000,26300,null,null],[17000001,18000000,28200,null,null],[18000001,19000000,30000,null,null],[19000001,20000000,31300,null,null]];
const enterprise:Band[]=[[100,1000,50],[1001,5000,50],[5001,10000,100],[10001,25000,200],[25001,50000,400],[50001,100000,800],[100001,250000,1500],[250001,500000,1500],[500001,1000000,2500],[1000001,2000000,3000],[2000001,3000000,4000],[3000001,4000000,5000],[4000001,5000000,6000],[5000001,6000000,7500],[6000001,7000000,8500],[7000001,8000000,10000],[8000001,9000000,11500],[9000001,10000000,12500],[10000001,11000000,14000],[11000001,12000000,15000],[12000001,13000000,16000],[13000001,14000000,17000],[14000001,15000000,18500],[15000001,16000000,20000],[16000001,17000000,21000],[17000001,18000000,22500],[18000001,19000000,24000],[19000001,20000000,25000],[20000001,25000000,30000],[25000001,30000000,35000],[30000001,35000000,40000],[35000001,40000000,45000],[40000001,45000000,50000],[45000001,50000000,54000],[50000001,55000000,58000],[55000001,60000000,62000],[60000001,65000000,66000],[65000001,70000000,70000],[70000001,75000000,74000],[75000001,80000000,79000],[80000001,85000000,84000],[85000001,90000000,89000],[90000001,95000000,94000],[95000001,100000000,99000]];
const purchase:Band[]=[[100,1000,10],[1001,5000,25],[5001,10000,50],[10001,25000,100],[25001,50000,200],[50001,100000,450],[100001,250000,1000],[250001,500000,1500],[500001,1000000,2000],[1000001,2000000,2500],[2000001,3000000,4000],[3000001,4000000,5000],[4000001,5000000,6000],[5000001,6000000,7500],[6000001,7000000,8500],[7000001,8000000,10000],[8000001,9000000,11500],[9000001,10000000,12500],[10000001,11000000,14000],[11000001,12000000,15000],[12000001,13000000,16000],[13000001,14000000,17000],[14000001,15000000,18500],[15000001,16000000,20000],[16000001,17000000,21000],[17000001,18000000,22500],[18000001,19000000,24000],[19000001,20000000,25000]];
export type MvolaTransferAccount = { type: string; name: string; category?: string };

/** Classifie un parcours à partir des deux comptes, sans déduire un tarif absent du barème MVola. */
export function classifyMvolaTransfer(source: MvolaTransferAccount | undefined, destination: MvolaTransferAccount | undefined): MvolaFeeOperation | null {
 if (!source || !destination) return null;
 const isMvola = (a: MvolaTransferAccount) => a.type === "mobile_money" && a.name.trim().toLowerCase() === "mvola";
 const sourceMvola = isMvola(source);
 const destinationMvola = isMvola(destination);
 if (sourceMvola && destination.type === "cash") return "withdrawal";
 if (source.type === "cash" && destinationMvola) return "deposit";
 if (sourceMvola && destination.type === "bank") return destination.name.toLowerCase().includes("bni") ? "bank_to_bni" : "bank_other";
 if (source.type === "bank" && destinationMvola) {
  if (!destination.category) return null;
  return source.name.toLowerCase().includes("bni") || destination.category === "personal" ? "deposit" : "bank_other";
 }
 if (sourceMvola && destination.type === "mobile_money") {
  // Tariff selection follows the source wallet category. No tariff is inferred
  // for merchant wallets where the published reference has no matching rule.
  if (destinationMvola) {
   if (source.category === "personal") return "transfer_mvola";
   if (source.category === "business") return "enterprise_transfer";
   return null;
  }
  if (source.category === "personal") return "transfer_other_operator";
  return null;
 }
 return null;
}

export function estimateMvolaFee(operation:MvolaFeeOperation, amount:number):number|null {
 if(!Number.isInteger(amount)||amount<=0)return null;
 // Official reference note: inter-operator transfers start at 300 MGA.
 if(operation==="transfer_other_operator"&&amount<300)return null;
 // The same official page states a 100,000,000 MGA maximum per Enterprise transfer.
 if(operation==="enterprise_transfer"&&amount>100_000_000)return null;
 if(operation==="deposit")return 0;
 if(operation==="bank_to_bni")return 0; // Fee on MVola side; bank may separately charge.
 if(operation==="bank_other")return Math.round(amount*0.01); // Bank-side fees may also apply.
 const bands:Band[]=operation==="withdrawal"?withdrawal:operation==="enterprise_transfer"?enterprise:operation==="merchant_payment"?purchase:transfer.map(b=>[b[0],b[1],b[operation==="transfer_mvola"?2:operation==="transfer_other_operator"?3:4]]);
 const band=bands.find(b=>amount>=b[0]&&amount<=b[1]);
 return band?.[2]??null; // unavailable is not free
}

/** The reference is a total debit for included mode, and a guaranteed net credit
 * for added mode. For tiered rates, included fees are based on the net amount
 * delivered, not automatically on the source debit.
 */
export function calculateMvolaTransfer(
 operation:MvolaFeeOperation, reference:number, mode:"included"|"added"
):{fee:number;debit:number;credit:number}|null {
 if(!Number.isInteger(reference)||reference<=0)return null;
 if(operation==="bank_other"&&mode==="included")return null; // Percentage base requires verification.
 if(mode==="added"){
  const fee=estimateMvolaFee(operation,reference);
  return fee===null?null:{fee,debit:reference+fee,credit:reference};
 }
 // Fixed tier tariffs: find the largest net amount satisfying net + fee(net)=gross.
 // Some amounts at tier boundaries have no exact solution and must not be guessed.
 if(operation==="bank_other")return null;
 const fixedFees = operation === "withdrawal" ? withdrawal.map(b => b[2])
  : operation === "enterprise_transfer" ? enterprise.map(b => b[2])
  : operation === "merchant_payment" ? purchase.map(b => b[2])
  : operation === "transfer_mvola" ? transfer.map(b => b[2])
  : operation === "transfer_other_operator" ? transfer.map(b => b[3])
  : operation === "transfer_non_subscriber" ? transfer.map(b => b[4])
  : operation === "deposit" || operation === "bank_to_bni" ? [0] : [];
 let best:{fee:number;debit:number;credit:number}|null=null;
 // Search every distinct tariff value, then verify its exact band against the net amount.
 // This avoids missing a valid solution when iteration oscillates at a tariff boundary.
 for (const fee of new Set(fixedFees.filter((value): value is number => value !== null))) {
  const net = reference - fee;
  if (net <= 0 || estimateMvolaFee(operation, net) !== fee) continue;
  if (!best || net > best.credit) best = { fee, debit: reference, credit: net };
 }
 return best;
}
