import { randomUUID } from "crypto";
import Link from "next/link";
import { requirePermission } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/current-org";
import { money } from "@/lib/money";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import {
  addMonthsClamped,
  buildLoanSchedule,
  type LoanRepaymentMethod,
  type LoanInterestCalculationMethod,
} from "@/lib/loan-finance";
import { LoanFinancialFields } from "@/components/loan-financial-fields";
import { LenderSelector } from "@/components/lender-selector";

async function createLoan(fd: FormData) {
  "use server";
  const ctx = await requireOrganization();
  await requirePermission(ctx, "treasury.transfer");
  const { supabase, organizationId } = ctx;

  const lenderName = String(fd.get("lender_name") || "").trim();
  const lenderCategory = String(fd.get("lender_category") || "").trim();
  const financialInstitutionId =
    String(fd.get("financial_institution_id") || "").trim() || null;
  const registerNewLender =
    String(fd.get("register_new_lender") || "false") === "true";
  const lenderLocationId =
    String(fd.get("lender_location_id") || "").trim() || null;
  let lenderCity = String(fd.get("lender_city") || "").trim();
  let lenderRegion = String(fd.get("lender_region") || "").trim() || null;
  let lenderBranchName =
    String(fd.get("lender_branch_name") || "").trim() || null¶»§q«^