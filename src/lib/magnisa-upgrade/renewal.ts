export type RenewalFrequency = "monthly" | "quarterly" | "semiannual" | "annual";

export function calculateNextRenewalDate(from: Date, frequency: RenewalFrequency): Date {
  if (Number.isNaN(from.getTime())) throw new Error("Invalid start date");
  const months = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }[frequency];
  const day = from.getUTCDate();
  const result = new Date(from.getTime());

  // Use UTC calendar arithmetic so the result is independent of the server's
  // timezone and daylight-saving transitions.
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
