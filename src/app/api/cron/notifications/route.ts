import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronAuthorizationError } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authError = getCronAuthorizationError(
    process.env.CRON_SECRET,
    request.headers.get("authorization"),
  );

  if (authError === 503) {
    console.error("notification cron blocked: CRON_SECRET is not configured");
    return NextResponse.json({ error: "Cron authentication is not configured" }, { status: 503 });
  }

  if (authError === 401) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const now = new Date();
    // Exécuter les deux routines indépendamment : la défaillance d'une famille
    // de notifications ne doit pas empêcher la tentative de l'autre.
    // Chaque routine déduplique ses alertes : un nouvel appel reste idempotent.
    const [loans, agenda] = await Promise.all([
      supabase.rpc("run_loan_deadline_notifications", {
        p_run_date: now.toISOString().slice(0, 10),
      }),
      supabase.rpc("run_mgmail_agenda_reminders", {
        p_run_at: now.toISOString(),
      }),
    ]);
    if (loans.error || agenda.error) {
      console.error("notification cron failed", {
        loans: loans.error?.message,
        agenda: agenda.error?.message,
      });
      return NextResponse.json({ error: "Notification engine failed" }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      result: {
        loan_notifications: loans.data,
        mgmail_agenda_reminders: agenda.data,
      },
    });
  } catch (error) {
    console.error("notification cron error", error);
    return NextResponse.json({ error: "Notification engine failed" }, { status: 500 });
  }
}
