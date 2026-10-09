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
  | "billing.view";

const defaults: Record<string, Set<Permission>> = {
  owner: new Set<Permission>([
    "customers.create","services.create","quotes.create","quotes.edit","quotes.accept","orders.manage",
    "invoices.create","invoices.issue","invoices.cancel","payments.record","expenses.record",
    "treasury.transfer","suppliers.manage","payroll.manage","payroll.pay","accounting.manage",
    "reports.export","settings.manage","users.manage","audit.view",
    "treasury.view","finance.view","accounting.view","payroll.view","suppliers.view","reports.view","sales.view","billing.view"
  ]),
  admin: new Set<Permission>([
    "customers.create","services.create","quotes.create","quotes.edit","quotes.accept","orders.manage",
    "invoices.create","invoices.issue","invoices.cancel","payments.record","expenses.record",
    "treasury.transfer","suppliers.manage","payroll.manage","payroll.pay","accounting.manage",
    "reports.export","settings.manage","users.manage","audit.view",
    "treasury.view","finance.view","accounting.view","payroll.view","suppliers.view","reports.view","sales.view","billing.view"
  ]),
  director: new Set<Permission>([
    "customers.create","services.create","quotes.create","quotes.edit","quotes.accept","orders.manage",
    "invoices.create","invoices.issue","payments.record","expenses.record","treasury.transfer",
    "suppliers.manage","reports.export","audit.view",
    "treasury.view","finance.view","accounting.view","suppliers.view","reports.view","sales.view","billing.view"
  ]),
  finance_manager: new Set<Permission>([
    "invoices.issue","invoices.cancel","payments.record","expenses.record","treasury.transfer",
    "suppliers.manage","payroll.pay","accounting.manage","reports.export","audit.view",
    "treasury.view","finance.view","accounting.view","payroll.view","suppliers.view","reports.view","billing.view"
  ]),
  accountant: new Set<Permission>([
    "invoices.issue","payments.record","expenses.record","suppliers.manage","payroll.manage",
    "accounting.manage","reports.export","audit.view",
    "treasury.view","finance.view","accounting.view","payroll.view","suppliers.view","reports.view","billing.view"
  ]),
  sales: new Set<Permission>([
    "customers.create","services.create","quotes.create","quotes.edit","sales.view","billing.view"
  ]),
  cashier: new Set<Permission>([
    "payments.record","expenses.record","treasury.view","billing.view"
  ]),
  hr: new Set<Permission>([
    "payroll.manage","payroll.view"
  ]),
  auditor: new Set<Permission>([
    "reports.export","audit.view","accounting.view","reports.view","billing.view"
  ]),
  employee: new Set<Permission>(),
  viewer: new Set<Permission>()
};

export async function assertPermission(
  ctx: { supabase: any; organizationId: string; role: string },
  permission: Permission
) {
  if (ctx.role === "owner") return;

  const { data } = await ctx.supabase
    .from("role_permissions")
    .select("allowed")
    .eq("organization_id", ctx.organizationId)
    .eq("role", ctx.role)
    .eq("permission_key", permission)
    .maybeSingle();

  const allowed = data ? !!data.allowed : !!defaults[ctx.role]?.has(permission);
  if (!allowed) throw new Error("Action non autorisée pour ce rôle.");
}

export async function hasPermission(
  ctx: { supabase: any; organizationId: string; role: string },
  permission: Permission
) {
  if (ctx.role === "owner") return true;
  const { data } = await ctx.supabase
    .from("role_permissions")
    .select("allowed")
    .eq("organization_id", ctx.organizationId)
    .eq("role", ctx.role)
    .eq("permission_key", permission)
    .maybeSingle();
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
