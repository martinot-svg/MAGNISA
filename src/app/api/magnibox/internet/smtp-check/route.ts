import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { hasPermission } from "@/lib/permissions";
import { MagniboxSmtpTransport, magniboxSmtpConfig } from "@/lib/orbit/transport/smtp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const ctx = await requireOrganization();
    if (!(await hasPermission(ctx, "users.manage"))) {
      return NextResponse.json({ ok: false, error: "Accès réservé aux administrateurs." }, { status: 403 });
    }
    if (!magniboxSmtpConfig()) {
      return NextResponse.json({ ok: false, error: "Configuration SMTP serveur incomplète." }, { status: 503 });
    }
    await new MagniboxSmtpTransport().verifyConnection();
    return NextResponse.json(
      { ok: true, connected: true, message: "Connexion et authentification SMTP vérifiées. Aucun e-mail n'a été envoyé." },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, connected: false, error: "Échec de connexion ou d'authentification SMTP. Vérifiez les paramètres serveur et les journaux privés." },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
