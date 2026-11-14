import { describe, expect, it } from "vitest";
import { agendaMonth, parseAgendaReminderOffsets, parseMGMailAgendaInput } from "./agenda";

const base = {
  scope: "personal", department: "",
  title: "Rendez-vous client", description: "Préparer le devis",
  startDay: "2026-11-28", startTime: "09:00",
  endDay: "2026-11-28", endTime: "10:00",
  timeZone: "Indian/Antananarivo", reminders: "15, 5, 1, 0",
};

describe("Agenda MAGNISA MGMail", () => {
  it("valide les rendez-vous personnels et leurs délais", () => {
    expect(parseMGMailAgendaInput(base)).toMatchObject({
      scope: "personal", title: "Rendez-vous client",
      reminderDays: [15, 5, 1, 0], department: null,
    });
  });

  it("valide un événement de département", () => {
    const event = parseMGMailAgendaInput({
      ...base, scope: "service", department: "Comptabilité",
    });
    expect(event.department).toBe("Comptabilité");
  });

  it.each([
    { endTime: "08:00" },
    { startDay: "2026-02-30" },
    { startTime: "25:30" },
    { timeZone: "MadeUp/Nowhere" },
    { title: "A" },
    { scope: "company", department: "Comptabilité" },
    { scope: "service", department: "" },
  ])("rejette un événement incorrect : %o", (patch) => {
    expect(() => parseMGMailAgendaInput({ ...base, ...patch })).toThrow();
  });

  it("refuse les doublons et les délais de rappel négatifs", () => {
    expect(() => parseAgendaReminderOffsets("5, 5")).toThrow(/uniques/);
    expect(() => parseAgendaReminderOffsets("-1")).toThrow(/entiers/);
    expect(() => parseAgendaReminderOffsets("366")).toThrow(/365/);
  });

  it("calcule un calendrier de novembre du lundi au dimanche", () => {
    const calendar = agendaMonth("2026-11");
    expect(calendar.days.length).toBe(30);
    expect(calendar.offset).toBe(6);
    expect(calendar.previous).toBe("2026-10");
    expect(calendar.next).toBe("2026-12");
  });

  it("gère les 29 jours de février bissextile", () => {
    expect(agendaMonth("2028-02").days.length).toBe(29);
  });
});
