/**
 * Parse an ISO timestamp with an explicit timezone and reject normalized
 * impossible dates/times (for example 2026-02-30 or 25:61).
 */
export function parseReservationDateWithOffset(value: unknown, field = "Date"): string {
  const match = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
    : null;
  if (!match) {
    throw new Error(field + " doit contenir un fuseau horaire explicite, par exemple 2026-12-01T09:00:00+03:00.");
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00", , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  if (
    month < 1 || month > 12 || day < 1 ||
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 14 || offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    throw new Error(field + " est invalide.");
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(field + " est invalide.");
  return date.toISOString();
}
