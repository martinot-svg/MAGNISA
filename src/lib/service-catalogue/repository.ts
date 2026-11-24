import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CatalogueService,
  CreateCatalogueServiceInput,
  CreateServiceCategoryInput,
  ServiceCategory,
} from "./types";
import { getServiceUnit } from "./units";
import { validateCategory, validateService } from "./validation";

type Db = SupabaseClient;

export async function listServiceCategories(db: Db, companyId: string) {
  const { data, error } = await db
    .from("service_categories")
    .select("*")
    .eq("company_id", companyId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as ServiceCategory[];
}

export async function createServiceCategory(db: Db, input: CreateServiceCategoryInput) {
  const errors = validateCategory(input);
  if (errors.length) throw new Error(errors.join(" "));
  const { data, error } = await db
    .from("service_categories")
    .insert({
      company_id: input.company_id,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      color: input.color || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ServiceCategory;
}

export async function setServiceCategoryActive(db: Db, id: string, active: boolean) {
  const { data, error } = await db
    .from("service_categories")
    .update({ is_active: active })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as ServiceCategory;
}

export async function listCatalogueServices(db: Db, companyId: string) {
  const { data, error } = await db
    .from("service_catalogue")
    .select("*, service_categories(name)")
    .eq("company_id", companyId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as (CatalogueService & { service_categories: { name: string } })[];
}

export async function createCatalogueService(db: Db, input: CreateCatalogueServiceInput) {
  const errors = validateService(input);
  if (errors.length) throw new Error(errors.join(" "));
  const unit = getServiceUnit(input.unit_code);
  if (!unit) throw new Error("Unité de mesure inconnue.");

  const { data, error } = await db
    .from("service_catalogue")
    .insert({
      company_id: input.company_id,
      category_id: input.category_id,
      code: input.code?.trim() || null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      unit_code: unit.code,
      unit_label: unit.label,
      unit_price_mga: input.unit_price_mga,
      vat_rate: input.vat_rate ?? 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CatalogueService;
}

export async function setCatalogueServiceActive(db: Db, id: string, active: boolean) {
  const { data, error } = await db
    .from("service_catalogue")
    .update({ is_active: active })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as CatalogueService;
}
