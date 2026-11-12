import Link from "next/link";
import { FormDialog } from "@/components/form-dialog";
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
  customer_mandates: "suppliers.view",
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

  const [{ data: rows = [] }, permissions, { count: unreadCount = 0 }] =
    await Promise.all([
      supabase
        .from("organization_features")
        .select("feature_key,enabled")
        .eq("organization_id", organizationId),
      getEffectivePermissions(ctx),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("recipient_user_id", user.id)
        .is("read_at", null)
        .is("archived_at", null),
    ]);

  const enabled = new Map(rows.map((row: any) => [row.feature_key, row.enabled]));
  const visible = FEATURE_CATALOG.filter((feature) => {
    const featureEnabled =
      feature.required ||
      feature.key === "settings" ||
      enabled.get(feature.key) !== false;

    if (!featureEnabled) return false;

    if (feature.key === "prospects") {
      return permissions.has("sales.view") || permissions.has("commissions.contribute");
    }
    if (feature.key === "commissions") {
      return permissions.has("commissions.view_own") ||
        permissions.has("commissions.view_team") ||
        permissions.has("commissions.policy.manage");
    }
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
                {showGroup ? (
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
                ) : null}
                <Link href={feature.href}>{feature.label}</Link>
                {feature.key === "accounting" ? <Link href="/exercices-comptables">Exercices comptables</Link> : null}
              </div>
            );
          })}
          <div>
            <Link href="/notifications">Notifications</Link>
          </div>
        </nav>
        <FormDialog title="Se déconnecter" buttonLabel="Se déconnecter" buttonClassName="button ghost">
          <form action={signOut}>
            <p>Confirme la fermeture de ta session MAGNISA.</p>
            <button className="button ghost">Confirmer la déconnexion</button>
          </form>
        </FormDialog>
      </aside>
      <main>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "12px 20px 0",
          }}
        >
          <NotificationBell
            userId={user.id}
            organizationId={organizationId}
            initialUnread={unreadCount ?? 0}
          />
        </div>
        {children}
      </main>
    </div>
  );
}
