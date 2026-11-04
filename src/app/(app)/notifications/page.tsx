import { NotificationCenter } from "@/components/notification-center";
import { requireOrganization } from "@/lib/current-org";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { user, organizationId } = await requireOrganization();
  return <NotificationCenter userId={user.id} organizationId={organizationId} />;
}
