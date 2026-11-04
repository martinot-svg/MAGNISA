import Link from "next/link";
import { signOut } from "@/server/actions/auth";
import { requireOrganization } from "@/lib/current-org";
import { FEATURE_CATALOG, type FeatureKey } from "@/lib/features";
import { getEffectivePermissions, type Permission } from "@/lib/permissions";
import { BrandMark } from "@/components/brand-mark";
import { NotificationBell } from "@/components/notification-bell";

const featurePermission: Partial<Record<FeatureKey, Permission>> = {
  prospects: "sales.view",
  clients: "billing.view",
  services: "sales.view",
  projects: "sales.view",
  quotes: "sales.view",
  orders: "sales.view",
  recurring_services: "sales.view",
  invoices: "billing.view",
  payments: "treasury.view",
  expenses: "treasury.view",
  treasury: "treasury.view",
  debts: "finance.view",
  partner_accounts: "finance.view",
  loans: "finance.view",
  payroll: "payroll.view",
  tax_social: "finance.view",
  budget: "finance.view",
  smart_analysis: "finance.view",
  suppliers: "suppliers.view",
  accounting: "accounting.view",
  immobilisations: "accounting.view",
  financial_statements: "accounting.view",
  reports: "reports.view",
  document_templates: "settings.manage",
  audit: "audit.view",
  users: "users.manage",
  settings: "settings.manage",
};

export async function AppShell({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrganization();
  const { supabase, organizationId, user } = ctx;

  const [{ data: rows = [] }, permissions, { count: u¶»§q«^