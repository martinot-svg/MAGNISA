import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronAuthorizationError } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Job = {
  id: string;
  organization_id: string;
  event_type: string;
  action_type: "notification.create" | "email.send" | "task.create";
  payload: Record<string, unknown>;
  lease_token: string;
};

const value = (input: unknown, max = 1200) =>
  typeof input === "string" ? input.trim().slice(0, max) : "";

async function dispatch(admin: ReturnType<typeof createAdminClient>, job: Job) {
  const p = job.payload ?? {};
  if (job.action_type === "notification.create") {
    const recipient = value(p.recipient_user_id, 80);
    const title = value(p.title, 180);
    if (!recipient || !title) throw new Error("recipient_user_id and title are required");
    const categories = ["finance", "loan", "payment", "treasury", "social", "tax", "service", "accounting", "system"];
    const priorities = ["info", "attention", "urgent", "critical"];
    const { error } = await admin.from("notifications").upsert({
      organization_id: job.organization_id,
      recipient_user_id: recipient,
      category: categories.includes(value(p.category)) ? value(p.category) : "system",
      priority: priorities.includes(value(p.priority)) ? value(p.priority) : "info",
      title,
      body: value(p.body),
      action_url: value(p.action_url, 500) || null,
      entity_type: value(p.entity_type, 80) || null,
      entity_id: value(p.entity_id, 80) || null,
      metadata: { automation_job_id: job.id, event_type: job.event_type },
      dedupe_key: `automation:${job.id}`,
    }, { onConflict: "organization_id,recipient_user_id,dedupe_key", ignoreDuplicates: true });
    if (error) throw error;
    return;
  }

  if (job.action_type === "task.create") {
    const actor = value(p.actor_user_id, 80);
    const title = value(p.title, 180);
    if (!actor || !title) throw new Error("actor_user_id and title are required");
    const priorities = ["low", "normal", "high", "urgent"];
    const dueDate = value(p.due_date, 10);
    const { error } = await admin.from("orbit_action_tasks").insert({
      organization_id: job.organization_id,
      created_by: actor,
      assigned_to: value(p.assigned_to, 80) || null,
      project_id: value(p.project_id, 80) || null,
      title,
      description: value(p.description, 10000),
      status: "todo",
      priority: priorities.includes(value(p.priority)) ? value(p.priority) : "normal",
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null,
    });
    if (error) throw error;
    return;
  }

  const to = value(p.to, 320);
  const subject = value(p.subject, 240);
  const body = value(p.text, 10000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || !body) {
    throw new Error("email.send requires a valid recipient, subject and text");
  }
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !MAIL_FROM) {
    throw new Error("SMTP provider is not configured");
  }
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  await transport.sendMail({
    from: MAIL_FROM,
    to,
    subject,
    text: body,
    messageId: `<magnisa-automation-${job.id}@magnisa>`,
  });
}

export async function GET(request: Request) {
  const auth = getCronAuthorizationError(process.env.CRON_SECRET, request.headers.get("authorization"));
  if (auth === 503) return NextResponse.json({ error: "Cron authentication is not configured" }, { status: 503 });
  if (auth === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_automation_jobs", {
    p_worker_id: `vercel:${process.env.VERCEL_REGION ?? "runtime"}`,
    p_limit: 20,
    p_lease_seconds: 120,
  });
  if (error) {
    console.error("automation worker claim failed", error);
    return NextResponse.json({ error: "Unable to claim jobs" }, { status: 500 });
  }

  const results: Array<{ id: string; status: string }> = [];
  for (const job of (data ?? []) as Job[]) {
    try {
      await dispatch(admin, job);
      const { data: completed, error: completionError } = await admin.rpc("complete_automation_job", {
        p_job_id: job.id,
        p_lease_token: job.lease_token,
      });
      if (completionError || completed !== true) throw completionError ?? new Error("Job lease lost");
      results.push({ id: job.id, status: "succeeded" });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown execution error";
      const { data: status, error: failureError } = await admin.rpc("fail_automation_job", {
        p_job_id: job.id,
        p_lease_token: job.lease_token,
        p_error: message.slice(0, 2000),
      });
      if (failureError) {
        console.error("automation failure persistence failed", { jobId: job.id, error: failureError });
        results.push({ id: job.id, status: "persistence_error" });
      } else {
        results.push({ id: job.id, status: String(status) });
      }
    }
  }
  return NextResponse.json({
    claimed: results.length,
    succeeded: results.filter((item) => item.status === "succeeded").length,
    results,
  });
}
