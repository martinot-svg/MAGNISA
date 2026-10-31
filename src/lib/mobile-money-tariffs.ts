/** Unified Mobile Money operator metadata and verified tariff adapters.
 * MVola: official public tariff reference already maintained in mvola-tariffs.ts.
 * Orange Money: public Orange Madagascar tariff PDF, effective 2025-02-01, used as an indicative reference.
 * Airtel Money: official site exposes the services but the public fee page is JS-only; fees therefore remain manual until an official tariff table is available.
 */
import { calculateMvolaTransfer, classifyMvolaTransfer, estimateMvolaFee, MVOLA_RATE_VERSION, type MvolaTransferAccount } from "@/lib/mvola-tariffs";

export type MobileMoneyOperator = "mvola" | "orange_money" | "airtel_money";
export const MOBILE_MONEY_OPERATORS: Array<{ value: MobileMoneyOperator; label: string }> = [
  { value: "mvola", label: "MVola" },
  { value: "orange_money", label: "Orange Money" },
  { value: "airtel_money", label: "Airtel Money" },
];
export const ORANGE_MONEY_RATE_VERSION = "2025-02-01";
export const AIRTEL_MONEY_RATE_STATUS = "manual_official_rate_required" as const;

type Band = readonly [number, number, number | null];
const orangeWithdrawal: Band[] = [
 [200,1000,65],[1001,5000,65],[5001,10000,150],[10001,20000,250],[20001,25000,250],[25001,50000,500],[50001,100000,1000],[100001,250000,1900],[250001,500000,1900],[500001,1000000,3200],[1000001,2000000,3800],[2000001,3000000,5000],[3000001,4000000,6300],[4000001,5000000,7500],[5000001,6000000,9400],[6000001,7000000,10700],[7000001,8000000,12500],[8000001,9000000,14400],[9000001,10000000,15700]
];
const orangeTransferSame: Band[] = [
 [200,1000,140],[1001,5000,140],[5001,10000,300],[10001,20000,500],[20001,25000,500],[25001,50000,900],[50001,100000,1400],[100001,250000,3000],[250001,500000,4500],[500001,1000000,7200],[1000001,2000000,11500],[2000001,3000000,14000],[3000001,4000000,17600],[4000001,5000000,18600],[5000001,6000000,null],[6000001,7000000,null],[7000001,8000000,null],[8000001,9000000,null],[9000001,10000000,null]
];
const orangeTransferOther: Band[] = [
 [200,1000,120],[1001,5000,120],[5001,10000,250],[10001,20000,400],[20001,25000,400],[25001,50000,880],[50001,100000,1300],[100001,250000,3000],[250001,500000,4500],[500001,1000000,6900],[1000001,2000000,11500],[2000001,3000000,14000],[3000001,4000000,17600],[4000001,5000000,18600],[5000001,6000000,21000],[6000001,7000000,24000],[7000001,8000000,28000],[8000001,9000000,32000],[9000001,10000000,37000]
];

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

function orangeFee(bands: Band[], amount: number): number | null {
 if (!Number.isInteger(amount) || amount <= 0) return null;
 return bands.find(([min,max]) => amount >= min && amount <= max)?.[2] ?? null;
}

export function estimateMobileMoneyTransferFee(
 operator: MobileMoneyOperator,
 source: MobileMoneyAccount | undefined,
 destination: MobileMoneyAccount | undefined,
 amount: number,
): number | null {
 if (!source || !destination) return null;
 if (operator === "mvola") {
  const op = classifyMvolaTransfer(source as MvolaTransferAccount, destination as MvolaTransferAccount);
  return op ? estimateMvolaFee(op, amount) : null;
 }
 if (operator === "orange_money") {
  if (source.type !== "mobile_money") return null;
  const destinationOperator = normalizeMobileMoneyOperator(destination.name);
  if (destination.type === "cash") return orangeFee(orangeWithdrawal, amount);
  if (destination.type === "mobile_money") return orangeFee(destinationOperator === "orange_money" ? orangeTransferSame : orangeTransferOther, amount);
  return null;
 }
 return null;
}

export function calculateMobileMoneyTransfer(
 operator: MobileMoneyOperator,
 source: MobileMoneyAccount | undefined,
 destination: MobileMoneyAccount | undefined,
 reference: number,
 mode: "included" | "added",
): { fee: number; debit: number; credit: number } | null {
 if (operator === "mvola") {
  const op = source && destination ? classifyMvolaTransfer(source as MvolaTransferAccount, destination as MvolaTransferAccount) : null;
  return op ? calculateMvolaTransfer(op, reference, mode) : null;
 }
 if (!source || !destination || !Number.isInteger(reference) || reference <= 0) return null;
 const fee = estimateMobileMoneyTransferFee(operator, source, destination, reference);
 if (fee === null) return null;
 if (mode === "added") return { fee, debit: reference + fee, credit: reference };
 for (const candidateFee of [fee]) {
  const net = reference - candidateFee;
  if (net > 0 && estimateMobileMoneyTransferFee(operator, source, destination, net) === candidateFee) return { fee: candidateFee, debit: reference, credit: net };
 }
 return null;
}

export function tariffReference(operator: MobileMoneyOperator): string {
 if (operator === "mvola") return `MVola ${MVOLA_RATE_VERSION}`;
 if (operator === "orange_money") return `Orange Money ${ORANGE_MONEY_RATE_VERSION}`;
 return "Airtel Money : tarif officiel à confirmer";
}
