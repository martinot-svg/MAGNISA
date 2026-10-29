export type CalendarPeriodicity = "monthly" | "quarterly" | "annual" | "one_off";

export type CalendarDueRule =
  | { type: "day_of_next_month"; day: number }
  | { type: "days_after_period_end"; days: number }
  | { type: "day_of_month_after_quarter"; day: number }
  | { type: "fixed_date"; date: string };

export type ConfigurableCalendarRule = {
  organismCode: string;
  periodicity: CalendarPeriodicity;
  dueRule: CalendarDueRule;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: "draft" | "validated" | "archived";
  sourceLabel?: string | null;
  sourceUrl?: string | null;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const validDay = (day: number) => Number.isInteger(day) && day >= 1 && day <= 31;

function dateAtMonthDay(year: number, monthIndex: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay)));
}

function parseIsoDate(value: string, label: string): Date {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) throw new Error(`${label} doit être au format AAAA-MM-JJ.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) throw new Error(`${label} est invalide.`);
  return date;
}

/** Compute a due date only from an explicitly configured rule. Does not infer legal deadlines. */
export function computeConfiguredDueDate(
  periodStart: string,
  periodEnd: string,
  rule: CalendarDueRule,
): string {
  const start = parseIsoDate(periodStart, "Début de période");
  const end = parseIsoDate(periodEnd, "Fin de période");
  if (end < start) throw new Error("La fin de période doit être postérieure ou égale au début.");

  switch (rule.type) {
    case "day_of_next_month": {
      if (!validDay(rule.day)) throw new Error("Le jour du mois doit être compris entre 1 et 31.");
      return isoDate(dateAtMonthDay(end.getUTCFullYear(), end.getUTCMonth() + 1, rule.day));
    }
    case "days_after_period_end": {
      if (!Number.isInteger(rule.days) || rule.days < 0 || rule.days > 366) {
        throw new Error("Le délai après période doit être un nombre entier entre 0 et 366.");
      }
      const due = new Date(end);
      due.setUTCDate(due.getUTCDate() + rule.days);
      return isoDate(due);
    }
    case "day_of_month_after_quarter": {
      if (!validDay(rule.day)) throw new Error("Le jour du mois doit être compris entre 1 et 31.");
      const quarterEndMonth = Math.floor(end.getUTCMonth() / 3) * 3 + 2;
      const dueMonth = quarterEndMonth + 1;
      const dueYear = end.getUTCFullYear() + Math.floor(dueMonth / 12);
      return isoDate(dateAtMonthDay(dueYear, dueMonth % 12, rule.day));
    }
    case "fixed_date": {
      const due = parseIsoDate(rule.date, "Date d'échéance");
      if (due < start) throw new Error("La date fixe ne peut pas précéder le début de période.");
      return isoDate(due);
    }
    default: {
      const exhaustive: never = rule;
      throw new Error(`Règle d'échéance non prise en charge: ${String(exhaustive)}`);
    }
  }
}

/** Only verified, effective rules may drive real declarations. */
export function isCalendarRuleEffective(rule: ConfigurableCalendarRule, onDate: string): boolean {
  const date = parseIsoDate(onDate, "Date de référence");
  const from = parseIsoDate(rule.effectiveFrom, "Date de début d'effet");
  const to = rule.effectiveTo ? parseIsoDate(rule.effectiveTo, "Date de fin d'effet") : null;
  return rule.status === "validated"
    && Boolean(rule.sourceLabel?.trim())
    && (!rule.sourceUrl || /^https?:\\/\\//i.test(rule.sourceUrl))
    && date >= from
    && (!to || date <= to);
}
