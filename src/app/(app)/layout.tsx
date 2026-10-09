import { AppShell } from "@/components/app-shell";import { requireOrganization } from "@/lib/current-org";
export default async function Layout({children}:{children:React.ReactNode}){await requireOrganization();return <AppShell>{children}</AppShell>}
