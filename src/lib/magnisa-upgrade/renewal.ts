export type RenewalFrequency = "monthly" | "quarterly" | "semiannual" | "annual";

export function calculateNextRenewalDate(from: Date, frequency: RenewalFrequency): Date {
  if (Number.isNaN(from.getTime())) throw new Error("Invalid start date");
  const months = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }[frequency];
  const day = from.getDate();
  const result = new Date(from);
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}
