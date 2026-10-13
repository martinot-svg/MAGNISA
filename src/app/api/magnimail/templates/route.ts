import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/magnimail/templates";

function validKey(value: string) {
  return /^[a-z0-9_]{2,60}$/.test(value);
}

export async function GET() {
  try {
    const { supabase, organizationId, role } = await requireOrganization();
    const { data = [], error } = await supabase
      .from("email_templates")
      .select("template_key,name,subject_template,body_template,is_active")
      .eq("organization_id", organizationId)
      .order("name");
    if (error) throw new Error(error.message);

    const stored = new Map((data as any[]).map((row) => [row.template_key, row]));
    const defaults = DEFAULT_EMAIL_TEMPLATES.map((item) => {
      const row = stored.get(item.key);
      return row
        ? {
            key: row.template_key,
            name: row.name,
            subject: row.subject_template,
            body: row.body_template,
            isActive: row.is_active,
            customized: true,
          }
        : {
            key: item.key,
            name: item.name,
            subject: item.subject,
            body: item.body,
            isActive: true,
            customized: false,
          };
    });
    const extra = (data as any[])
      .filter((row) => !DEFAULT_EMAIL_TEMPLATES.some((item) => item.key === row.template_key))
      .map((row) => ({
        key: row.template_key,
        name: row.name,
        subject: row.subject_template,
        body: row.body_template,
        isActive: row.is_active,
        customized: true,
      }));

    return NextResponse.json({
      items: [...defaults, ...extra],
      canManage: role === "owner" || role === "admin",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible de charger les modèles.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, organizationId, user, role } = await requireOrganization();
    if (!["owner", "admin"].includes(role)) {
      return NextResponse.json({ error: "Action réservée aux administrateurs." }, { status: 403 });
    }
    const payload = (await request.json().catch(() => null)) as
      | { key?: string; name?: string; subject?: string; body?: string; isActive?: boolean }
      | null;
    const key = String(payload?.key || "").trim().toLowerCase();
    const name = String(payload?.name || "").trim();
    const subject = String(payload?.subject || "").trim();
    const body = String(payload?.body || "").trim();

    if (!validKey(key) || !name || name.length > 120 || subject.length > 180 || body.length > 50_000) {
      return NextResponse.json({ error: "Modèle e-mail invalide." }, { status: 400 });
    }

    const { error } = await supabase.from("email_templates").upsert({
      organization_id: organizationId,
      template_key: key,
      name,
      subject_template: subject,
      body_template: body,
      is_active: payload?.isActive !== false,
      created_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,template_key" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Impossible d'enregistrer le modèle.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { supabase, organizationId, role } = await requireOrganization();
    if (!["owner", "admin"].includes(role)) {
      return NextResponse.json({ error: "Action réservée aux administrateurs." }, { status: 403 });
    }
    const key = new URL(request.url).searchParams.get("key") || "";
    if (!validKey(key)) return NextResponse.json({ error: "Modèle invalide." }, { status: 400 });
    const { error } = await supabase
      .from("email_templates")
      .delete()
      .eq("organization_id", organizationId)
      .eq("template_key", key);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Suppression impossible.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
