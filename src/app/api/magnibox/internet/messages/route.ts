import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const identityId = request.nextUrl.searchParams.get("identityId") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identityId)) {
    return NextResponse.json({ ok: false, error: "Boîte MAGNIBOX invalide." }, { status: 400 });
  }
  try {
    const ctx = await requireOrganization();
    const access = await ctx.supabase.rpc("orbit_can_public_mail_access", {
      p_org: ctx.organizationId, p_identity: identityId, p_action: "read",
    });
    const canSend = await ctx.supabase.rpc("orbit_can_public_mail_access", {
      p_org: ctx.organizationId, p_identity: identityId, p_action: "send",
    });
    if (access.error || canSend.error) return NextResponse.json({ ok: false, error: "Permissions de boîte indisponibles." }, { status: 503 });
    if (access.data !== true && canSend.data !== true) return NextResponse.json({ ok: false, error: "Accès à cette boîte refusé." }, { status: 403 });

    const result = await ctx.supabase.from("orbit_external_messages")
      .select("id,direction,status,from_email,to_emails,subject,body_text,created_at,provider_email_id")
      .eq("organization_id", ctx.organizationId)
      .eq("identity_id", identityId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (result.error) return NextResponse.json({ ok: false, error: "Messages Internet indisponibles." }, { status: 503 });
    const rows = result.data ?? [];
    const messageIds = rows.map(row => row.id);
    const attachmentResult = messageIds.length
      ? await ctx.supabase.from("orbit_external_message_attachments")
        .select("id,message_id,display_name,byte_size")
        .in("message_id", messageIds)
        .eq("scan_status", "available")
      : { data: [], error: null };
    if (attachmentResult.error) return NextResponse.json({ ok: false, error: "Pièces jointes indisponibles." }, { status: 503 });
    const attachmentsByMessage = new Map<string, Array<{id:string;display_name:string;byte_size:number}>>();
    for (const attachment of attachmentResult.data ?? []) {
      const list = attachmentsByMessage.get(attachment.message_id) ?? [];
      list.push({ id: attachment.id, display_name: attachment.display_name, byte_size: attachment.byte_size });
      attachmentsByMessage.set(attachment.message_id, list);
    }
    const items = rows.map(row => ({ ...row, attachments: attachmentsByMessage.get(row.id) ?? [] }));
    return NextResponse.json({ ok: true, items }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Session MAGNISA indisponible." }, { status: 401 });
  }
}
