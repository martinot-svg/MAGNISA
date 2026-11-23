"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-org";
import { assertPermission } from "@/lib/permissions";

export async function scheduleProspectFollowUp(formData: FormData) {
  const ctx = await requireOrganization();
  await assertPermission(ctx, "commissions.contribute");
  const parsed = z.object({
    prospect_id: z.string().uuid(),
    follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
    follow_up_note: z.string().trim().max(1000),
  }).safeParse({
    prospect_id: String(formData.get("prospect_id") ?? ""),
    follow_up_date: String(formData.get("follow_up_date") ?? ""),
    follow_up_note: String(formData.get("follow_up_note") ?? ""),
  });
  if (!parsed.success) throw new Error("Date ou note de relance invalide.");
  const nextFollowUp = parsed.data.follow_up_date
    ? new Date(parsed.data.follow_up_date + "T09:00:00+03:00").toISOString()
    : null;
  const { data, error } = await ctx.supabase.from("prospects")
    .update({ next_follow_up_at: nextFollowUp, follow_up_note: parsed.data.follow_up_note || null })
    .eq("organization_id", ctx.organizationId)
    .eq("id", parsed.data.prospect_id)
    .not("status", "in", '("won","lost")')
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Prospect introuvable, clôturé ou non modifiable.");
  revalidatePath("/prospects");
  revalidatePath("/prospects/" + parsed.data.prospect_id);
}
