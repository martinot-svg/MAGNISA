import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const ctx = await requireOrganization();
    const result = await ctx.supabase.from("orbit_public_identities")
      .select("id,email_address,status,receive_enabled,created_at")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (result.error) return NextResponse.json({ ok: false, error: "Boîtes Internet MAGNIBOX indisponibles." }, { status: 503 });
    return NextResponse.json({ ok: true, items: result.data ?? [] }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Session MAGNISA indisponible." }, { status: 401 });
  }
}
