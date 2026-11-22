import { NotificationCenter } from "@/components/notification-center";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await requireOrganization();
  const canManageSettings = await hasPermission(ctx, "settings.manage");
  return <><div className="pageHead"><div><p className="eyebrow">Espace de travail</p><h1>Notifications</h1><p>Retrouve les alertes commerciales et financières de ton organisation.</p></div>{canManageSettings ? <a className="button secondary" href="/notifications/parametres">Paramétrer les rappels</a> : null}</div><NotificationCenter userId={ctx.user.id} organizationId={ctx.organizationId} /></>;
}
