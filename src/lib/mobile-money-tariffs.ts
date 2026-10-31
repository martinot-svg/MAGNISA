/** Unified Mobile Money operator metadata and tariff adapters.
 * Orange Money source supplied by the user: PLAN TARIFAIRE ORANGE MONEY – MAJ 1,
 * effective 2025-02-01. Values are transcribed as provided; missing bands stay unavailable.
 * The document contradicts itself on merchant payments (section 1 tariff grid vs section 5 free).
 * Merchant payment estimation is therefore deliberately disabled until Orange confirms the applicable rule.
 */
import { calculateMvolaTransfer, classifyMvolaTransfer, estimateMvolaFee, MVOLA_RATE_VERSION, type MvolaTransferAccount } from "@/lib/mvola-tariffs";

export type MobileMoneyOperator = "mvola" | "orange_money" | "airtel_money";
export const MOBILE_MONEY_OPERATORS: Array<{ value: MobileMoneyOperator; label: string }> = [
 { value: "mvola", label: "MVola" },
 { value: "orange_money", label: "Orange Money" },
 { value: "airtel_money", label: "Airtel Money" },
];
export const ORANGE_MONEY_RATE_VERSION = "2025-02-01";
export const ORANGE_MONEY_MERCHANT_PAYMENT_STATUS = "conflicting_source" as const;
export const AIRTEL_MONEY_RATE_STATUS = "manual_official_rate_required" as const;

type Band = readonly [number, number, number | null];
const orangeDeposit: Band[] = [
 [200,1000,100],[1001,5000,150],[5001,10000,275],[10001,20000,550],[20001,25000,650],
 [25001,50000,1300],[50001,100000,1900],[100001,250000,3400],[250001,500000,4700],
 [500001,1000000,8800],[1000001,2000000,14700],[2000001,3000000,19600],
 [3000001,4000000,24500],[4000001,5000000,29400],[5000001,6000000,34300],
 [6000001,7000000,39200],[7000001,8000000,44100],[8000001,9000000,49000],[9000001,10000000,53900]
];
const orangeWithdrawal: Band[] = [
 [200,1000,65],[1001,5000,65],[5001,10000,150],[10001,20000,250],[20001,25000,250],
 [25001,50000,500],[50001,100000,1000],[100001,250000,1900],[250001,500000,1900],
 [500001,1000000,3200],[1000001,2000000,3800],[2000001,3000000,5000],
 [3000001,4000000,6300],[4000001,5000000,7500],[5000001,6000000,9400],
 [6000001,7000000,10700],[7000001,8000000,12500],[8000001,9000000,14400],[9000001,10000000,15700]
];
const orangeTransferSame: Band[] = [
 [200,1000,140],[1001,5000,140],[5001,10000,300],[10001,20000,500],[20001,25000,500],
 [25001,50000,900],[50001,100000,1400],[100001,250000,3000],[250001,500000,4500],
 [500001,1000000,7200],[1000001,2000000,11500],[2000001,3000000,14000],
 [3000001,4000000,17600],[4000001,5000000,18600],[5000001,6000000,null],
 [6000001,7000000,null],[7000001,8000000,null],[8000001,9000000,null],[9000001,10000000,null]
];
const orangeTransferOther: Band[] = [
 [200,1000,120],[1001,5000,120],[5001,10000,250],[10001,20000,400],[20001,25000,400],
 [25001,50000,880],[50001,100000,1300],[100001,250000,3000],[250001,500000,4500],
 [500001,1000000,6900],[1000001,2000000,11500],[2000001,3000000,14000],
 [3000001,4000000,17600],[4000001,5000000,18600],[5000001,6000000,21000],
 [6000001,7000000,24000],[7000001,8000000,28000],[8000001,9000000,32000],[9000001,10000000,37000]
];
const orangeTransferMicrofinance: Band[] = [
 [200,1000,200],[1001,5000,225],[5001,10000,450],[10001,20000,900],[20001,25000,900],
 [25001,50000,1900],[50001,100000,2800],[100001,250000,5000],[250001,500000,6300],
 [500001,1000000,11500],[1000001,2000000,18000],[2000001,3000000,23000],
 [3000001,4000000,28000],[4000001,5000000,33000],[5000001,6000000,38000],
 [6000001,7000000,43000],[7000001,8000000,48000],[8000001,9000000,53000],[9000001,10000000,58000]
];
const orangeIzyCash: Band[] = [[500,10000,100],[10001,50000,200],[50001,500000,1000],[500001,1000000,3000]];

export function normalizeMobileMoneyOperator(value: string | null | undefined): MobileMoneyOperator | null {
 const v = (value ?? "").trim().toLowerCase();
 if (v === "mvola" || v.includes("mvola")) return "mvola";
 if (v === "orange_money" || v === "orange money" || v.includes("orange")) return "orange_money";
 if (v === "airtel_money" || v === "airtel money" || v.includes("airtel")) return "airtel_money";
 return null;
}
export function operatorLabel(operator: MobileMoneyOperator | null): string {
 return MOBILE_MONEY_OPERATORS.find(item => item.value === operator)?.label ?? "Mobile Money";
}
export type MobileMoneyAccount = { type: string; name: string; category?: string | null };
export type OrangeMoneyOperation = "deposit" | "withdrawal" | "transfer_orange" | "transfer_other_network" | "transfer_microfinance" | "izy_cash" | "merchant_payment" | "orange_bill_payment" | "buy_bundle";
function orangeFee(bands: Band[], amount: number): number | null {
 if (!Number.isInteger(amount) || amount <= 0) return null;
 return bands.find(([min,max]) => amount >= min && amount <= max)?.[2] ?? null;
}
export function estimateOrangeMoneyFee(operation: OrangeMoneyOperation, amount: number): number | null {
 switch (operation) {
  case "deposit": return orangeFee(orangeDeposit, amount);
  case "withdrawal": return orangeFee(orangeWithdrawal, amount);
  case "transfer_orange": return orangeFee(orangeTransferSame, amount);
  case "transfer_other_network": return orangeFee(orangeTransferOther, amount);
  case "transfer_microfinance": return orangeFee(orangeTransferMicrofinance, amount);
  case "izy_cash": return orangeFee(orangeIzyCash, amount);
  // Conflicting values in the supplied document: section 1 gives a banded fee,
  // while section 5 explicitly says merchant payment is free.
  case "merchant_payment": return null;
  case "orange_bill_payment": return 500;
  case "buy_bundle": return 0;
  default: return null;
 }
}
export function orangeMoneyMerchantPaymentNotice(): string {
 return "Document Orange contradictoire : la section 1 associe un barème au dépôt/paiement marchand, tandis que la section 5 indique le paiement marchand gratuit. Tarif non automatisé en attente de confirmation Orange.";
}
export function estimateMobileMoneyTransferFee(operator: MobileMoneyOperator, source: MobileMoneyAccount | undefined, destination: MobileMoneyAccount | undefined, amount: number): number | null {
 if (!source || !destination) return null;
 if (operator === "mvola") {
  const op = classifyMvolaTransfer(source as MvolaTransferAccount, destination as MvolaTransferAccount);
  return op ? estimateMvolaFee(op, amount) : null;
 }
 if (operator === "orange_money") {
  const destinationName = destination.name.toLowerCase();
  if (source.type === "cash" && destination.type === "mobile_money") return orangeFee(orangeDeposit, amount);
  if (source.type !== "mobile_money") return null;
  if (destinationName.includes("izy") && destinationName.includes("cash")) return orangeFee(orangeIzyCash, amount);
  if (destinationName.includes("microfinance") || destinationName.includes("micro-finance") || destinationName.includes("micro finance")) return orangeFee(orangeTransferMicrofinance, amount);
  if (destination.type === "cash") return orangeFee(orangeWithdrawal, amount);
  if (destination.type === "mobile_money") return orangeFee(normalizeMobileMoneyOperator(destination.name) === "orange_money" ? orangeTransferSame : orangeTransferOther, amount);
  if (destination.type === "bank") return orangeFee(orangeTransferOther, amount);
  return null;
 }
 return null;
}
export function calculateMobileMoneyTransfer(operator: MobileMoneyOperator, source: MobileMoneyAccount | undefined, destination: MobileMoneyAccount | undefined, reference: number, mode: "included" | "added"): { fee: number; debit: number; credit: number } | null {
 if (operator === "mvola") {
  const op = source && destination ? classifyMvolaTransfer(source as MvolaTransferAccount, destination as MvolaTransferAccount) : null;
  return op ? calculateMvolaTransfer(op, reference, mode) : null;
 }
 if (!source || !destination || !Number.isInteger(reference) || reference <= 0) return null;
 const fee = estimateMobileMoneyTransferFee(operator, source, destination, reference);
 if (fee === null) return null;
 if (mode === "added") return { fee, debit: reference + fee, credit: reference };
 const net = reference - fee;
 return net > 0 ? { fee, debit: reference, credit: net } : null;
}
export function tariffReference(operator: MobileMoneyOperator): string {
 if (operator === "mvola") return `MVola ${MVOLA_RATE_VERSION}`;
 if (operator === "orange_money") return `Orange Money ${ORANGE_MONEY_RATE_VERSION}`;
 return "Airtel Money : tarif officiel à confirmer";
}
