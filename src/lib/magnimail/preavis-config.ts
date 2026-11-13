import { DEFAULT_PREAVIS_RULES, type PreavisRule, type PreavisTone } from "./preavis";

export const MAX_PREAVIS_STEPS = 20;
export const PREAVIS_TONES: readonly PreavisTone[] = [
  "information",
  "courtois",
  "important",
  "dernier",
];

/**
 * Valide les règles saisies par un administrateur avant toute sauvegarde.
 * Les identifiants sont reconstruits côté serveur pour éviter les collisions
 * et aucune clé provenant du navigateur n'est prise pour une autorisation.
 */
export function normalizePreavisRules(value: unknown): PreavisRule[] {
  if (!Array.isArray(value) || value.length > MAX_PREAVIS_STEPS) {
    throw new Error("La configuration doit contenir au maximum 20 préavis.");
  }

  const offsets = new Set<number>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Format de préavis invalide.");
    }
    const rule = item as Record<string, unknown>;
    const daysBefore = rule.daysBefore;
    const tone = rule.tone;
    if (
      typeof daysBefore !== "number" ||
      !Number.isSafeInteger(daysBefore) ||
      daysBefore < 1 ||
      daysBefore > 3650
    ) {
      throw new Error("Chaque délai doit être un nombre entier de 1 à 3650 jours.");
    }
    if (offsets.has(daysBefore)) throw new Error("Les délais de préavis doivent être uniques.");
    if (typeof tone !== "string" || !PREAVIS_TONES.includes(tone as PreavisTone)) {
      throw new Error("Niveau de rappel invalide.");
    }
    if (typeof rule.enabled !== "boolean") {
      throw new Error("État d'activation du préavis invalide.");
    }
    offsets.add(daysBefore);
    return {
      id: `j${daysBefore}`,
      daysBefore,
      tone: tone as PreavisTone,
      enabled: rule.enabled,
    };
  }).sort((a, b) => b.daysBefore - a.daysBefore);
}

export function parsePreavisRulesJson(value: string): PreavisRule[] {
  if (value.length > 12_000) throw new Error("Configuration de préavis trop longue.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Configuration JSON de préavis invalide.");
  }
  return normalizePreavisRules(parsed);
}

export function defaultPreavisRules(): PreavisRule[] {
  return DEFAULT_PREAVIS_RULES.map((rule) => ({ ...rule }));
}
