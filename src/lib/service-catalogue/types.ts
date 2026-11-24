export type ServiceUnitCode =
  | "HOUR"
  | "NIGHT"
  | "DAY"
  | "HALF_DAY"
  | "WEEK"
  | "MONTH"
  | "PACKAGE";

export interface ServiceUnit {
  code: ServiceUnitCode;
  label: string;
  symbol: string;
  description: string;
}

export interface ServiceCategory {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CatalogueService {
  id: string;
  company_id: string;
  category_id: string;
  code: string | null;
  name: string;
  description: string | null;
  unit_code: ServiceUnitCode;
  unit_label: string;
  unit_price_mga: number;
  vat_rate: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateServiceCategoryInput {
  company_id: string;
  name: string;
  description?: string | null;
  color?: string | null;
}

export interface CreateCatalogueServiceInput {
  company_id: string;
  category_id: string;
  code?: string | null;
  name: string;
  description?: string | null;
  unit_code: ServiceUnitCode;
  unit_price_mga: number;
  vat_rate?: number;
}
