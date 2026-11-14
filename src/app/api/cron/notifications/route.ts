import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronAuthorizationError } from "@/lib/cron-auth";
import { runMGMailScheduledDispatch } from "@/lib/magnimail/scheduled-worker";
import { reconcileMGMailDomains } from "@/lib/magnimail/domain-health";

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
    const [loans, agenda, mail] = await Promise.allSettled([
      supabase.rpc("run_loan_deadline_notifications", {
        p_run_date: now.toISOString().slice(0, 10),
      }),
      supabase.rpc("run_mgmail_agenda_reminders", {
        p_run_at: now.toISOString(),
      }),
      (async () => {
        // Check DNS before scheduled dispatch, never concurrently.
        const domainHealth = await reconcileMGMailDomains({
          admin: supabase, apiKey: process.env.MGMAIL_RESEND_API_KEY,
          now, limit: 8,
        });
        const scheduled = await runMGMailScheduledDispatch({ admin: supabase, now });
        return { domainHealth, scheduled };
      })(),
    ]);
    const loanError = loans.status === "rejected"
      ? "Traitement impossible" : loans.value.error?.message;
    const agendaError = agenda.status === "rejected"
      ? "Traitement impossible" : agenda.value.error?.message;
    const scheduledError = mail.status === "rejected"
      ? "Contrôle DNS ou traitement programmé impossible" : null;
    if (loanError || agendaError || scheduledError) {
      console.error("notification cron failed", {
        loans: loanError,
        agenda: agendaError,
        mgmail_scheduled: scheduledError,
      });
      return NextResponse.json({
        error: "Notification engine failed",
        // Avoid echoing actual recipients or message bodies in cron logs.
      }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      result: {
        loan_notifications: loans.status === "fulfilled" ? loans.value.data : null,
        mgmail_agenda_reminders: agenda.status === "fulfilled" ? agenda.value.data : null,
        mgmail_scheduled: mail.status === "fulfilled" ? mail.value.scheduled : null,
        mgmail_domains: mail.status === "fulfilled" ? mail.value.domainHealth : null,
      },
    });
  } catch (error) {
    console.error("notification cron error", error);
    return NextResponse.json({ error: "Notification engine failed" }, { status: 500 });
  }
}
