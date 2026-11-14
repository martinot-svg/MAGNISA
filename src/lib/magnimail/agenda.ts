export type MGMailAgendaScope = "personal" | "service" | "company";

export type MGMailAgendaInput = {
  scope: MGMailAgendaScope;
  department: string | null;
  title: string;
  description: string;
  startDay: string;
  startTime: string;
  endDay: string;
  endTime: string;
  timeZone: string;
  reminderDays: number[];
};

function validDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(s + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
}

function validClock(s: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function parseAgendaReminderOffsets(text: string): number[] {
  if (!text.trim()) return [];
  if (text.length > 200) throw new Error("Liste de rappels trop longue.");
  const values = text.split(",").map((chunk) => chunk.trim());
  if (values.length > 20 || values.some((value) => !/^\d+$/.test(value))) {
    throw new Error("Indiquez au maximum 20 délais entiers, séparés par des virgules.");
  }
  const result = values.map(Number);
  if (result.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 365)
    || new Set(result).size !== result.length) {
    throw new Error("Les délais doivent être uniques et compris entre 0 et 365 jours.");
  }
  return result.sort((a, b) => b - a);
}

export function parseMGMailAgendaInput(input: Record<string, string>): MGMailAgendaInput {
  const scope = input.scope as MGMailAgendaScope;
  if (!["personal", "service", "company"].includes(scope)) {
    throw new Error("Type d'agenda inconnu.");
  }
  const department = input.department?.trim() || null;
  if ((scope === "service" && (!department || department.length < 2 || department.length > 100))
      || (scope !== "service" && department !== null)) {
    throw new Error("Département invalide pour ce calendrier.");
  }
  const title = (input.title || "").trim();
  const description = (input.description || "").trim();
  if (title.length < 2 || title.length > 180 || description.length > 5000) {
    throw new Error("Titre ou description d'événement invalide.");
  }
  const { startDay, startTime, endDay, endTime } = input;
  if (!validDay(startDay) || !validDay(endDay)
      || !validClock(startTime) || !validClock(endTime)
      || endDay + endTime <= startDay + startTime) {
    throw new Error("Dates ou heures de l'événement invalides.");
  }
  const timeZone = input.timeZone?.trim() || "Indian/Antananarivo";
  if (timeZone.length > 64 || timeZone.length < 3) {
    throw new Error("Fuseau horaire invalide.");
  }
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone });
  } catch {
    throw new Error("Fuseau horaire invalide.");
  }
  return {
    scope, department, title, description,
    startDay, startTime, endDay, endTime, timeZone,
    reminderDays: parseAgendaReminderOffsets(input.reminders || ""),
  };
}

export function agendaMonth(value?: string): {
  month: string;
  start: string;
  end: string;
  days: { date: string; day: number }[];
  offset: number;
  previous: string;
  next: string;
} {
  const today = new Date().toISOString().slice(0, 7);
  const month = value && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) ? value : today;
  const [year, mm] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, mm - 1, 1));
  const next = new Date(Date.UTC(year, mm, 1));
  const previous = new Date(Date.UTC(year, mm - 2, 1));
  const endDate = new Date(next.getTime() - 86400000);
  const offset = (first.getUTCDay() + 6) % 7;
  const days = Array.from({ length: endDate.getUTCDate() }, (_, i) => ({
    day: i + 1, date: `${month}-${String(i + 1).padStart(2, "0")}`,
  }));
  return {
    month, start: first.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
    offset, days,
    previous: previous.toISOString().slice(0, 7),
    next: next.toISOString().slice(0, 7),
  };
}
