/**
 * Age calculation for signup. A February 29 birthday is treated as February 28
 * in non-leap years; this convention is explicit and should be reviewed for
 * applicable local legal requirements before production launch.
 */
const DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/;
export function isValidBirthDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isAtLeast18(value: string, today = new Date()): boolean {
  if (!isValidBirthDate(value)) return false;
  const birth = new Date(value + "T00:00:00.000Z");
  const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (birth.getTime() > now.getTime()) return false;
  let anniversaryYear = birth.getUTCFullYear() + 18;
  const month = birth.getUTCMonth();
  const day = birth.getUTCDate();
  const lastDay = new Date(Date.UTC(anniversaryYear, month + 1, 0)).getUTCDate();
  const anniversary = new Date(Date.UTC(anniversaryYear, month, Math.min(day, lastDay)));
  return now.getTime() >= anniversary.getTime();
}
