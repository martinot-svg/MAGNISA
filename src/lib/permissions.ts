import { redirect } from "next/navigation";
export type Permission =
  | "customers.create"
  | "services.create"
  | "quotes.create"
  | "quotes.edit"
  | "quotes.accept"
  | "orders.manage"
  | "invoices.create"
  | "invoices.issue"
  | "invoices.cancel"
  | "payments.record"
  | "expenses.record"
  | "treasury.transfer"
  | "suppliers.manage"
  | "payroll.manage"
  | "payroll.pay"
  | "accounting.manage"
  | "reports.export"
  | "settings.manage"
  | "users.manage"
  | "audit.view"
  | "treasury.view"
  | "finance.view"
  | "accounting.view"
  | "payroll.view"
  | "suppliers.view"
  | "reports.view"
  | "sales.view"
  | "billing.view"
  | "prospects.convert"
  | "commissions.contribute"
  | "commissions.view_own"
  | "commissions.view_team"
  | "commissions.policy.manage"
  | "commissions.calculate"
  | "commissions.approve"
  | "commissions.pay"
  | "commissions.audit";

const contributorPermissions: Permission[] = [
  "prospects.convert", "commissions.contribute", "commissions.view_own", "commissions.calculate"
];
const teamCommissionPermissions: Permission[] = ["commissions.view_team", "commissions.audit"];
const financeCommissionPermissions: Permission[] = ["commissions.approve", "commissions.pay"];

const defaults: Record<string, Set<Permission>> = {
  owner: new Set<Permission>([
    "customers.create","services.create","quotes.create","quotes.edit","quotes.accept","orders.manage",
    "invoices.create","invoices.issue","invoices.cancel","payments.record","expenses.record",
    "treasury.transfer","suppliers.manage","payroll.manage","payroll.pay","accounting.manage",
    "reports.export","settings.manage","users.manage","audit.view",
    "treasury.view","finance.view","accounting.view","payroll.view","suppliers.view","reports.view","sales.view","billing.view",
    ...contributorPermissions, ...teamCommissionPermissions, "commissions.policy.manage"
  ]),
  admin: new Set<Permission>([
    "customers.create","services.create","quotes.create","quotes.edit","quotes.accept","orders.manage",
    "invoices.create","invoices.issue","invoices.cancel","payments.record","expenses.record",
    "treasury.transfer","suppliers.manage","payroll.manage","payroll.pay","accounting.manage",
    "reports.export","settings.manage","users.manage","audit.view",
    "treasury.view","finance.view","accounting.view","payroll.view","suppliers.view","reports.view","sales.view","billing.view",
    ...contributorPermissions, ...teamCommissionPermissions, "commissions.policy.manage"
  ]),
  director: new Set<Permission>([
    "customers.create","services.create","quotes.create","quotes.edit","quotes.accept","orders.manage",
    "invoices.create","invoices.issue","payments.record","expenses.record","treasury.transfer",
    "suppliers.manage","reports.export","audit.view",
    "treasury.view","finance.view","accounting.view","suppliers.view","reports.view","sales.view","billing.view",
    ...contributorPermissions, ...teamCommissionPermissions
  ]),
  finance_manager: new Set<Permission>([
    "invoices.issue","invoices.cancel","payments.record","expenses.record","treasury.transfer",
    "suppliers.manage","payroll.pay","accounting.manage","reports.export","audit.view",
    "treasury.view","finance.view","accounting.view","payroll.view","suppliers.view","reports.view","billing.view",
    ...contributorPermissions, ...teamCommissionPermissions, ...financeCommissionPermissions, "commissions.policy.manage"
  ]),
  accountant: new Set<Permission>([
    "invoices.issue","payments.record","expenses.record","suppliers.manage","payroll.manage",
    "accounting.manage","reports.export","audit.view",
    "treasury.view","finance.view","accounting.view","payroll.view","suppliers.view","reports.view","billing.view",
    ...contributorPermissions, ...teamCommissionPermissions, ...financeCommissionPermissions
  ]),
  sales: new Set<Permission>([
    "customers.create","services.create","quotes.create","quotes.edit","sales.view","billing.view",
    ...contributorPermissions
  ]),
  cashier: new Set<Permission>([
    "payments.record","expenses.record","treasury.view","billing.view",
    ...contributorPermissions
  ]),
  hr: new Set<Permission>([
    "payroll.manage","payroll.view",
    ...contributorPermissions
  ]),
  auditor: new Set<Permission>([
    "reports.export","audit.view","accounting.view","reports.view","billing.view",
    ...teamCommissionPermissions
  ]),
  employee: new Set<Permission>([...contributorPermissions]),
  viewer: new Set<Permission>()
};

export async function assertPermission(
  ctx: { supabase: any; organizationId: string; role: string },
  permission: Permission
) {
  if (permission === "commissions.approve" || permission === "commissions.pay") {
    if (ctx.role !== "finance_manager" && ctx.role !== "accountant") {
      throw new Error("Cette opération est réservée à l'équipe Finance.");
    }
  }
  if (ctx.role === "owner") return;

  const { data, error } = await ctx.supabase
    .from("role_permissions")
    .select("allowed")
    .eq("organization_id", ctx.organizationId)
    .eq("role", ctx.role)
    .eq("permission_key", permission)
    .maybeSingle();

  if (error) throw new Error("Impossible de vérifier les permissions. Action refusée.");
  const allowed = data ? !!data.allowed : !!defaults[ctx.role]?.has(permission);
  if (!allowed) throw new Error("Action non autorisée pour ce rôle.");
}

export async function hasPermission(
  ctx: { supabase: any; organizationId: string; role: string },
  permission: Permission
) {
  if (permission === "commissions.approve" || permission === "commissions.pay") {
    return ctx.role === "finance_manager" || ctx.role === "accountant";
  }
  if (ctx.role === "owner") return true;
  const { data, error } = await ctx.supabase
    .from("role_permissions")
    .select("allowed")
    .eq("organization_id", ctx.organizationId)
    .eq("role", ctx.role)
    .eq("permission_key", permission)
    .maybeSingle();
  if (error) throw new Error("Impossible de vérifier les permissions. Accès refusé.");
  return data ? !!data.allowed : !!defaults[ctx.role]?.has(permission);
}


export async function getEffectivePermissions(
  ctx: { supabase: any; organizationId: string; role: string }
) {
  const effective = new Set<Permission>(defaults[ctx.role] ?? []);
  if (ctx.role === "owner") return effective;

  const { data = [], error } = await ctx.supabase
    .from("role_permissions")
    .select("permission_key,allowed")
    .eq("organization_id", ctx.organizationId)
    .eq("role", ctx.role);

  if (error) throw new Error(error.message);

  for (const row of data as Array<{ permission_key: Permission; allowed: boolean }>) {
    if (row.allowed) effective.add(row.permission_key);
    else effective.delete(row.permission_key);
  }
  return effective;
}


export async function requirePermission(
  ctx: { supabase: any; organizationId: string; role: string },
  permission: Permission
) {
  if (!(await hasPermission(ctx, permission))) {
    redirect("/dashboard?access=denied");
  }
}
