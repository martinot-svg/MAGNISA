import Link from "next/link";
import { signOut } from "@/server/actions/auth";
import { requireOrganization } from "@/lib/current-org";
import { FEATURE_CATALOG, type FeatureKey } from "@/lib/features";
import { getEffectivePermissions, type Permission } from "@/lib/permissions";
import { BrandMark } from "@/components/brand-mark";

const featurePermission: Partial<Record<FeatureKey, Permission>> = {
  prospects: "sales.view",
  clients: "billing.view",
  services: "sales.view",
  projects: "sales.view",
  quotes: "sales.view",
  orders: "sales.view",
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
  financial_statements: "accounting.view",
  reports: "reports.view",
  document_templates: "settings.manage",
  audit: "audit.view",
};

export async function AppShell({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrganization();
  const { supabase, organizationId } = ctx;

  const [{ data: rows = [] }, permissions] = await Promise.all([
    supabase
      .from("organization_features")
      .select("feature_key,enabled")
      .eq("organization_id", organizationId),
    getEffectivePermissions(ctx),
  ]);

  const enabled = new Map(rows.map((r: any) => [r.feature_key, r.enabled]));
  const visible = FEATURE_CATALOG.filter((feature) => {
    const featureEnabled =
      feature.required || feature.key === "settings" || enabled.get(feature.key) !== false;
    if (!featureEnabled) return false;

    const requiredPermission = featurePermission[feature.key];
    return !requiredPermission || permissions.has(requiredPermission);
  });

  let lastGroup = "";

  return (
    <div className="appShell">
      <aside>
        <BrandMark href="/dashboard" compact />
        <nav>
          {visible.map((feature) => {
            const showGroup = feature.group !== lastGroup;
            lastGroup = feature.group;
            return (
              <div key={feature.key}>
                {showGroup && (
                  <div
                    style={{
                      padding: "15px 10px 5px",
                      fontSize: 9,
                      textTransform: "uppercase",
                      letterSpacing: ".14em",
                      color: "#71819f",
                    }}
                  >
                    {feature.group}
                  </div>
                )}
                <Link href={feature.href}>{feature.label}</Link>
              </div>
            );
          })}
        </nav>
        <form action={signOut}>
          <button className="button ghost">Se déconnecter</button>
        </form>
      </aside>
      <main>{children}</main>
    </div>
  );
}
