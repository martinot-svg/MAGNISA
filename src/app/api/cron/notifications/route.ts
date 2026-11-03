import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (configuredSecret && authorization !== `Bearer ${configuredSecret}`) {
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

    return NextResponse.json({ ok: true, result: data });
  } catch (error) {
    console.error("notification cron error", error);
    return NextResponse.json({ error: "Notification engine failed" }, { status: 500 });
  }
}
