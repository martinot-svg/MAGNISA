import { requirePermission, hasPermission } from "@/lib/permissions";
import { requireOrganization } from "@/lib/current-org";
import { money } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";
import {
  cancelOrderAction,
  createRecurringServiceContractAction,
  quoteToOrderAction,
} from "@/server/actions/commercial";
import Link from "next/link";

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Quotidienne",
  weekly: "Hebdomadaire",
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  semiannual: "Semestrielle",
  annual: "Annuelle",
};

export default async function Orders() {
  const ctx = await requireOrganization();
  await requirePermission(ctx, "sales.view");
  const canManage = await hasPermission(ctx, "orders.manage");
  const { supabase, organizationId } = ctx;

  const [
    { data: org },
    { data: quotes = [] },
    { data: orders = [] },
    { data: recurringLines = [] },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("currency")
      .eq("id", organizationId)
      .single(),
    supabase
      .from("quotes")
      .select("id,number,total,status,customers(name)")
      .eq("organization_id", organizationId)
      .eq("status", "accepted")
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select(
        "*,customers(name),invoices(id,number,status),order_lines(id,service_id,description,quantity,unit,unit_price,tax_rate,sort_order,servi¶»§q«^