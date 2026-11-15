import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { requireOrganization } from "@/lib/current-org";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const BUCKET = "magnibox-attachments";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeName(value: string) {
  return value.normalize("NFKC").replace(/[^\w .()\-]/g, "_").replace(/^\.+/, "").slice(0, 180) || "attachment.bin";
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireOrganization();
    const form = await request.formData();
    const draftId = String(form.get("draftId") || "");
    const file = form.get("file");
    if (!UUID.test(draftId) || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Brouillon ou fichier invalide." }, { status: 400 });
    }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ ok: false, error: "Un fichier doit peser entre 1 octet et 30 Mio." }, { status: 413 });
    }

    const admin = createAdminClient();
    const draft = await admin.from("orbit_external_messages")
      .select("id,identity_id,created_by,status,direction")
      .eq("id", draftId).eq("organization_id", ctx.organizationId)
      .eq("created_by", ctx.user.id).eq("direction", "outgoing").eq("status", "draft").maybeSingle();
    if (draft.error) return NextResponse.json({ ok: false, error: "Brouillon indisponible." }, { status: 503 });
    if (!draft.data) return NextResponse.json({ ok: false, error: "Brouillon introuvable." }, { status: 404 });
    const access = await ctx.supabase.rpc("orbit_can_public_mail_access", {
      p_org: ctx.organizationId, p_identity: draft.data.identity_id, p_action: "send",
    });
    if (access.error || access.data !== true) return NextResponse.json({ ok: false, error: "Accès au brouillon refusé." }, { status: 403 });

    const existing = await admin.from("orbit_external_message_attachments")
      .select("id,byte_size").eq("message_id", draftId).eq("organization_id", ctx.organizationId);
    if (existing.error) return NextResponse.json({ ok: false, error: "Pièces jointes indisponibles." }, { status: 503 });
    const currentBytes = (existing.data ?? []).reduce((sum, item) => sum + item.byte_size, 0);
    if ((existing.data ?? []).length >= 5 || currentBytes + file.size > MAX_TOTAL_BYTES) {
      return NextResponse.json({ ok: false, error: "Limite de cinq fichiers ou de 150 Mio dépassée." }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length !== file.size) return NextResponse.json({ ok: false, error: "Lecture du fichier incomplète." }, { status: 400 });
    const storagePath = ctx.organizationId + "/" + draftId + "/" + randomUUID();
    const uploaded = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: "application/octet-stream", upsert: false,
    });
    if (uploaded.error) return NextResponse.json({ ok: false, error: "Dépôt privé du fichier impossible." }, { status: 503 });

    const saved = await admin.from("orbit_external_message_attachments").insert({
      organization_id: ctx.organizationId, message_id: draftId, storage_path: storagePath,
      display_name: safeName(file.name), detected_mime_type: "application/octet-stream",
      byte_size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      scan_status: "quarantined",
    }).select("id,display_name,byte_size,scan_status").single();
    if (saved.error || !saved.data) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ ok: false, error: "Enregistrement de la pièce jointe impossible." }, { status: 503 });
    }
    return NextResponse.json({ ok: true, attachment: saved.data }, {
      status: 201, headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Téléversement MAGNIBOX indisponible." }, { status: 401 });
  }
}
