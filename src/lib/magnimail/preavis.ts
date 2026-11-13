/**
 * Planification déterministe des préavis de facturation MGMail.
 *
 * Ces fonctions ne transmettent aucun e-mail : l'envoi doit être réalisé
 * par un worker autorisé, idempotent et relié à une véritable boîte Internet.
 * Les dates sont des jours civils YYYY-MM-DD, sans heure ni conversion locale.
 */
export type PreavisTone = "information" | "courtois" | "important" | "dernier";

export type PreavisRule = {
  id: string;
  daysBefore: number;
  tone: PreavisTone;
  enabled: boolean;
};

export type PlannedPreavis = {
  ruleId: string;
  daysBefore: number;
  tone: PreavisTone;
  scheduledDate: string;
  billingDate: string;
};

export const DEFAULT_PREAVIS_RULES: readonly PreavisRule[] = [
  { id: "j15", daysBefore: 15, tone: "information", enabled: true },
  { id: "j10", daysBefore: 10, tone: "courtois", enabled: true },
  { id: "j5", daysBefore: 5, tone: "important", enabled: true },
  { id: "j1", daysBefore: 1, tone: "dernier", enabled: true },
];

/** Refuser les dates invalides et les valeurs qui déborderaient en JS. */
function parseCivilDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date de facturation invalide.");
  }
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Date de facturation invalide.");
  }
  return date;
}

export function planBillingPreavis(input: {
  billingDate: string;
  contractStatus: string;
  rules: readonly PreavisRule[];
  asOfDate?: string;
  alreadyIssued?: boolean;
}): PlannedPreavis[] {
  const target = parseCivilDate(input.billingDate);
  const asOfDate = input.asOfDate ? parseCivilDate(input.asOfDate) : undefined;

  if (input.contractStatus !== "active" || input.alreadyIssued) return [];

  const usedOffsets = new Set<number>();
  const events: PlannedPreavis[] = [];

  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    // Évite les envois le jour même et les échéances déraisonnablement lointaines.
    if (!Number.isSafeInteger(rule.daysBefore) || rule.daysBefore < 1 || rule.daysBefore > 3650) {
      throw new Error("Le délai de préavis doit être compris entre 1 et 3650 jours.");
    }
    if (!rule.id.trim() || usedOffsets.has(rule.daysBefore)) {
      throw new Error("Chaque délai de préavis actif doit être unique et identifié.");
    }
    usedOffsets.add(rule.daysBefore);
    const sendDate = new Date(target.getTime());
    sendDate.setUTCDate(sendDate.getUTCDate() - rule.daysBefore);
    const scheduledDate = sendDate.toISOString().slice(0, 10);
    // Si l'abonnement est créé tardivement, ne pas envoyer les anciens préavis.
    if (asOfDate && scheduledDate < input.asOfDate!) continue;
    events.push({
      ruleId: rule.id,
      daysBefore: rule.daysBefore,
      tone: rule.tone,
      scheduledDate,
      billingDate: input.billingDate,
    });
  }
  return events.sort((a, b) =>
    a.scheduledDate.localeCompare(b.scheduledDate) || a.ruleId.localeCompare(b.ruleId),
  );
}

const openings: Record<PreavisTone, string> = {
  information: "Nous vous informons que",
  courtois: "Nous vous rappelons que",
  important: "Nous attirons votre attention sur le fait que",
  dernier: "Nous vous rappelons que",
};

export function renderBillingPreavis(input: {
  companyName: string;
  customerName: string;
  serviceName: string;
  billingDate: string;
  tone: PreavisTone;
  estimatedAmount?: string;
}) {
  const date = parseCivilDate(input.billingDate);
  const readableDate = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const company = input.companyName.trim();
  const customer = input.customerName.trim();
  const service = input.serviceName.trim();
  if (!company || !customer || !service) throw new Error("Informations de préavis incomplètes.");
  const amount = input.estimatedAmount?.trim();
  return {
    subject: `Préavis de facturation — ${service} — ${readableDate}`,
    body: [
      `Bonjour ${customer},`,
      "",
      `${openings[input.tone]} la prochaine facture liée à votre prestation « ${service} » est prévue pour le ${readableDate}.`,
      ...(amount ? [`Montant estimatif à ce jour : ${amount} (sous réserve des éventuels ajustements contractuels).`] : []),
      "Cette information est un préavis : aucune facture n'est jointe ni considérée comme déjà émise.",
      "",
      "Pour toute question, vous pouvez répondre directement à cet e-mail.",
      "",
      `Cordialement,\n${company}`,
    ].join("\n"),
  };
}
