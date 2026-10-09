export type Permission=
  |"customers.create"|"services.create"|"quotes.create"|"quotes.edit"|"quotes.accept"|"orders.manage"|"invoices.create"|"invoices.issue"|"invoices.cancel"|"payments.record"
  |"expenses.record"|"treasury.transfer"|"suppliers.manage"|"payroll.manage"|"payroll.pay"|"accounting.manage"|"reports.export"|"settings.manage"|"users.manage"|"audit.view";

const defaults:Record<string,Set<Permission>>={
  owner:new Set<Permission>(["customers.create","services.create","quotes.create","quotes.edit","quotes.accept","orders.manage","invoices.create","invoices.issue","invoices.cancel","payments.record","expenses.record","treasury.transfer","suppliers.manage","payroll.manage","payroll.pay","accounting.manage","reports.export","settings.manage","users.manage","audit.view"]),
  admin:new Set<Permission>(["customers.create","services.create","quotes.create","quotes.edit","quotes.accept","orders.manage","invoices.create","invoices.issue","invoices.cancel","payments.record","expenses.record","treasury.transfer","suppliers.manage","payroll.manage","payroll.pay","accounting.manage","reports.export","settings.manage","users.manage","audit.view"]),
  director:new Set<Permission>(["customers.create","services.create","quotes.create","quotes.edit","quotes.accept","orders.manage","invoices.create","invoices.issue","payments.record","expenses.record","treasury.transfer","suppliers.manage","reports.export","audit.view"]),
  finance_manager:new Set<Permission>(["invoices.issue","invoices.cancel","payments.record","expenses.record","treasury.transfer","suppliers.manage","payroll.pay","accounting.manage","reports.export","audit.view"]),
  accountant:new Set<Permission>(["invoices.issue","payments.record","expenses.record","suppliers.manage","payroll.manage","accounting.manage","reports.export","audit.view"]),
  sales:new Set<Permission>(["customers.create","services.create","quotes.create","quotes.edit"]),
  cashier:new Set<Permission>(["payments.record","expenses.record"]),
  hr:new Set<Permission>(["payroll.manage"]),auditor:new Set<Permission>(["reports.export","audit.view"]),employee:new Set<Permission>(),viewer:new Set<Permission>()
};
export async function assertPermission(ctx:{supabase:any;organizationId:string;role:string},permission:Permission){
  if(ctx.role==="owner")return;
  const {data}=await ctx.supabase.from("role_permissions").select("allowed").eq("organization_id",ctx.organizationId).eq("role",ctx.role).eq("permission_key",permission).maybeSingle();
  const allowed=data?!!data.allowed:!!defaults[ctx.role]?.has(permission);
  if(!allowed)throw new Error("Action non autorisée pour ce rôle.");
}
