import Link from "next/link";
import { CalendarRuleDialog } from "@/components/calendar-rule-dialog";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission, requirePermission } from "@/lib/permissions";

type CalendarRuleRow = {
  id: string;
  organism_code: string;
  label: string;
  periodicity: "monthly" | "quarterly" | "annual" | "one_off";
  due_rule: Record<string, unknown>;
  effective_from: string;
  effective_to: string | null;
  source_label: string | null;
  source_url: string | null;
  status: "draft" | "validated" | "archived";
  notes: string | null;
  version: number;
  updated_at: string;
};

async function createDraft(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await assertPermission(ctx, "payroll.manage");
  const organism = String(fd.get("organism_code") || "").trim().toUpperCase();
  const label = String(fd.get("label") || "").trim();
  const periodicity = String(fd.get("periodicity") || "");
  const dueType = String(fd.get("due_type") || "");
  const dueDay = Number(fd.get("due_day") || 0);
  const days = Number(fd.get("days_after") || 0);
  const effectiveFrom = String(fd.get("effective_from") || "");
  const effectiveTo = String(fd.get("effective_to") || "") || null;
  const sourceLabel = String(fd.get("source_label") || "").trim() || null;
  const sourceUrl = String(fd.get("source_url") || "").trim() || null;
  const notes = String(fd.get("notes"¶»§q«^