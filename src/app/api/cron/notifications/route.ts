import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronAuthorizationError } from "@/lib/cron-auth";\nimport { synchronizeMagniboxTlds } from "@/lib/orbit/tld-sync";

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
    return NextResponse.json({ ok: true, result: data });
  } catch (error) {
    console.error("notification cron error", error);
    return NextResponse.json({ error: "Notification engine failed" }, { status: 500 });
  }
}
