/** Pure UTC calendar utilities; no tenant or transport state. */
export type OrbitDay = { date: string; day: number };
export type OrbitMonth = {
  month: string; first: string; last: string;
  previous: string; next: string; offset: number; days: OrbitDay[];
};
export function orbitMonth(value?: string, today = new Date()): OrbitMonth {
  const fallback = today.toISOString().slice(0, 7);
  const month = value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : fallback;
  const [year, mm] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, mm - 1, 1));
  const nextMonth = new Date(Date.UTC(year, mm, 1));
  const previous = new Date(Date.UTC(year, mm - 2, 1));
  const last = new Date(nextMonth.getTime() - 86400000);
  return {
    month,
    first: first.toISOString().slice(0, 10),
    last: last.toISOString().slice(0, 10),
    previous: previous.toISOString().slice(0, 7),
    next: nextMonth.toISOString().slice(0, 7),
    offset: (first.getUTCDay() + 6) % 7,
    days: Array.from({ length: last.getUTCDate() }, (_, index) => ({
      date: `${month}-${String(index + 1).padStart(2, "0")}`, day: index + 1,
    })),
  };
}
export function orbitDateLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso
    ? new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "2-digit", month: "long", year: "numeric" }).format(d)
    : iso;
}
