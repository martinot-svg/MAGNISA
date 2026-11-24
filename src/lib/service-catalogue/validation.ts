import { SERVICE_UNITS } from "./units";
import type { CreateCatalogueServiceInput, CreateServiceCategoryInput } from "./types";

export function validateCategory(input: CreateServiceCategoryInput): string[] {
  const errors: string[] = [];
  if (!input.company_id?.trim()) errors.push("L'entreprise est obligatoire.");
  if (!input.name?.trim()) errors.push("Le nom de la catégorie est obligatoire.");
  if (input.name?.trim().length > 120) errors.push("Le nom ne doit pas dépasser 120 caractères.");
  return errors;
}

export function validateService(input: CreateCatalogueServiceInput): string[] {
  const errors: string[] = [];
  if (!input.company_id?.trim()) errors.push("L'entreprise est obligatoire.");
  if (!input.category_id?.trim()) errors.push("La catégorie est obligatoire.");
  if (!input.name?.trim()) errors.push("Le nom de la prestation est obligatoire.");
  if (!SERVICE_UNITS.some((unit) => unit.code === input.unit_code)) errors.push("Unité de mesure invalide.");
  if (!Number.isFinite(input.unit_price_mga) || input.unit_price_mga < 0) {
    errors.push("Le prix unitaire doit être un montant positif ou nul.");
  }
  const vat = input.vat_rate ?? 0;
  if (!Number.isFinite(vat) || vat < 0 || vat > 100) errors.push("Le taux de TVA doit être compris entre 0 et 100.");
  return errors;
}
