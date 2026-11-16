import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronAuthorizationError } from "@/lib/cron-auth";
import { synchronizeMagniboxTlds } from "@/lib/orbit/tld-sync";

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
    const { data, error } = await supabase.rpc("run_loan_deadline_notifications", {
      p_run_date: new Date().toISOString().slice(0, 10),
    });

    if (error) {
      console.error("notification cron failed", error);
      return NextResponse.json({ error: "Notification engine failed" }, { status: 500 });
    }

    // Reuse the existing daily free-tier cron (weekly TLD refresh).
    // Catalogue failure never interrupts accounting/notification processing.
    if(new Date().getUTCDay()===0){
      try{await synchronizeMagniboxTlds();}
      catch(syncError){console.error("Weekly TLD catalogue refresh unavailable",syncError);}
    }
    // Agenda reminders stay disabled until the production schema and RLS
    // have been verified and the explicit feature flag is enabled.
    let agendaReminders: unknown = null;
    if (process.env.MAGNIBOX_AGENDA_REMINDERS_ENABLED === "true") {
      const agenda = await supabase.rpc("run_mgmail_agenda_reminders", {
        p_run_at: new Date().toISOString(),
      });
      if (agenda.error) {
        console.error("Magnibox agenda reminder engine failed", agenda.error);
        return NextResponse.json({ error: "Agenda reminder engine failed" }, { status: 500 });
      }
      agendaReminders = agenda.data;
    }
    return NextResponse.json({ ok: true, result: data, agendaReminders });
  } catch (error) {
    console.error("notification cron error", error);
    return NextResponse.json({ error: "Notification engine failed" }, { status: 500 });
  }
}
