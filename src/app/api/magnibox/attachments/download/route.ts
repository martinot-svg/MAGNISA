import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A short-lived download is issued only after the caller's RLS-visible
 * attachment row confirms scan_status=available and mailbox read access.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Pièce jointe introuvable." }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });

  const { data: attachment, error } = await supabase
    .from("orbit_external_message_attachments")
    .select("storage_path,display_name")
    .eq("id", id)
    .eq("scan_status", "available")
    .maybeSingle();
  if (error || !attachment) return NextResponse.json({ error: "Pièce jointe introuvable." }, { status: 404 });

  const admin = createAdminClient();
  const { data, error: signedError } = await admin.storage
    .from("magnibox-attachments")
    .createSignedUrl(attachment.storage_path, 60, { download: attachment.display_name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 180) || "attachment.bin" });
  if (signedError || !data?.signedUrl) {
    return NextResponse.json({ error: "Téléchargement indisponible." }, { status: 503 });
  }

  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}
