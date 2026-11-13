import { NextResponse, type NextRequest } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { parsePreavisOffsets } from "@/lib/magnimail/preavis";

/**
 * Enregistre seulement une politique de préavis, sans envoyer d'e-mail.
 * L'accès est contrôlé par organisation, permission et RLS Supabase.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireOrganization();
    if (!(await hasPermission(ctx, "orders.manage"))) {
      return NextResponse.json({ error: "Vous n'êtes pas autorisé à configurer les préavis." }, { status: 403 });
    }
    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object" ||
        typeof (payload as { offsets?: unknown }).offsets !== "string" ||
        typeof (payload as { enabled?: unknown }).enabled !== "boolean") {
      return NextResponse.json({ error: "Configuration de préavis invalide." }, { status: 400 });
    }
    const input = payload as { offsets: string; enabled: boolean };
    if (input.offsets.length > 500) {
      return NextResponse.json({ error: "Trop de délais de préavis." }, { status: 400 });
    }
    let rules;
    try {
      rules = parsePreavisOffsets(input.offsets);
    } catch (error) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : "Délais invalides.",
      }, { status: 400 });
    }

    const { data: existing, error: lookupError } = await ctx.supabase
      .from("mgmail_preavis_policies")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .is("recurring_contract_id", null)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: "La configuration MGMail n'est pas encore disponible." }, { status: 503 });
    }

    const update = {
      rules,
      enabled: input.enabled,
      updated_by: ctx.user.id,
      updated_at: new Date().toISOString(),
    };

    const result = existing
      ? await ctx.supabase
          .from("mgmail_preavis_policies")
          .update(update)
          .eq("id", existing.id)
          .eq("organization_id", ctx.organizationId)
          .select("id")
          .single()
      : await ctx.supabase
          .from("mgmail_preavis_policies")
          .insert({
            ...update,
            organization_id: ctx.organizationId,
            recurring_contract_id: null,
          })
          .select("id")
          .single();

    if (result.error || !result.data) {
      console.error("MGMail preavis policy update failed", result.error);
      return NextResponse.json({ error: "Impossible d'enregistrer les délais de préavis." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    console.error("MGMail preavis policy request failed", error);
    return NextResponse.json({ error: "Impossible de traiter cette configuration MGMail." }, { status: 500 });
  }
}
