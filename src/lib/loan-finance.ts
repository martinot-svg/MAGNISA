export type LoanRepaymentMethod = "annuity" | "equal_principal" | "bullet";

export interface LoanScheduleInput {
  principal: number;
  annualRatePercent: number;
  periods: number;
  paymentsPerYear: number;
  firstDueDate: string;
  method: LoanRepaymentMethod;
  currencyDecimals?: number;
}

export interface LoanInstallment {
  number: number;
  dueDate: string;
  openingPrincipal: number;
  principal: number;
  interest: number;
  payment: number;
  closingPrincipal: number;
}

export interface LoanSchedule {
  installments: LoanInstallment[];
  principal: number;
  totalInterest: number;
  totalPayments: number;
  periodicRate: number;
}

/**
 * Builds a deterministic amortization schedule.
 *
 * The annual nominal rate is divided by paymentsPerYear. Interest is calculated
 * on the outstanding principal for each period (ordinary simple-period interest).
 * This function deliberately does not capitalize unpaid interest: capitalization
 * is a separate contractual event and must never be inferred from the rate alone.
 */
export function buildLoanSchedule(input: LoanScheduleInput): LoanSchedule {
  const {
    principal,
    annualRatePercent,
    periods,
    paymentsPerYear,
    firstDueDate,
    method,
    currencyDecimals = 2,
  } = input;

  if (!Number.isFinite(principal) || principal <= 0) throw new Error("Le capital doit être strictement positif.");
  if (!Number.isFinite(annualRatePercent) || annualRatePercent < 0 || annualRatePercent > 1000) throw new Error("Le taux annuel est invalide.");
  if (!Number.isInteger(periods) || periods < 1 || periods > 1200) throw new Error("La durée doit être comprise entre 1 et 1 200 échéances.");
  if (!Number.isInteger(paymentsPerYear) || paymentsPerYear < 1 || paymentsPerYear > 366) throw new Error("La périodicité annuelle est invalide.");
  if (!Number.isInteger(currencyDecimals) || currencyDecimals < 0 || currencyDecimals > 4) throw new Error("La précision monétaire est invalide.");
  if (!["annuity", "equal_principal", "bullet"].includes(method)) throw new Error("Méthode de remboursement invalide.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate) || !isValidDate(firstDueDate)) throw new Error("La première date d'échéance est invalide.");

  const factor = 10 ** currencyDecimals;
  const round = (value: number) => Math.round((value + Number.EPSILON) * factor) / factor;
  const periodicRate = annualRatePercent / 100 / paymentsPerYear;
  const roundedPrincipal = round(principal);
  const regularPayment = periodicRate === 0
    ? roundedPrincipal / periods
    : roundedPrincipal * periodicRate / (1 - (1 + periodicRate) ** -periods);

  let balance = roundedPrincipal;
  let totalInterest = 0;
  let totalPayments = 0;
  const installments: LoanInstallment[] = [];

  for (let index = 0; index < periods; index += 1) {
    const openingPrincipal = balance;
    const interest = round(openingPrincipal * periodicRate);
    let principalPart: number;

    if (method === "bullet") {
      principalPart = index === periods - 1 ? balance : 0;
    } else if (method === "equal_principal") {
      principalPart = index === periods - 1
        ? balance
        : Math.min(balance, round(roundedPrincipal / periods));
    } else {
      principalPart = index === periods - 1
        ? balance
        : Math.min(balance, round(regularPayment - interest));
    }

    const payment = round(principalPart + interest);
    balance = round(Math.max(0, balance - principalPart));
    totalInterest = round(totalInterest + interest);
    totalPayments = round(totalPayments + payment);

    installments.push({
      number: index + 1,
      dueDate: addMonthsClamped(firstDueDate, index),
      openingPrincipal,
      principal: principalPart,
      interest,
      payment,
      closingPrincipal: balance,
    });
  }

  if (balance !== 0) throw new Error("L'échéancier n'a pas soldé le capital. Vérifie les paramètres.");

  return {
    installments,
    principal: roundedPrincipal,
    totalInterest,
    totalPayments,
    periodicRate,
  };
}

function isValidDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addMonthsClamped(dateValue: string, offset: number): string {
  const [year, month, day] = dateValue.split("-").map(Number);
  const absoluteMonth = month - 1 + offset;
  const targetYear = year + Math.floor(absoluteMonth / 12);
  const targetMonth = ((absoluteMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonth + 1).padStart(2, "0"),
    String(targetDay).padStart(2, "0"),
  ].join("-");
}
