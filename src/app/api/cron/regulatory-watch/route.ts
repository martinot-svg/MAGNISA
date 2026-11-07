import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCronAuthorizationError } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCES = [
  { key: "dgi-legislation", title: "DGI - Codes et manuels", url: "https://www.impots.mg/explorer?path=%2Flegislation%2FCodes+et+Manuels" },
  { key: "cnlegis", title: "CNLegis - Textes législatifs", url: "https://cnlegis.gov.mg/" },
  { key: "cnaps-sme", title: "CNaPS - Historique SME", url: "https://www.cnaps.mg/historique-sme" },
  { key: "fmfp-legal", title: "FMFP - Fondement légal", url: "https://www.fmfp.mg/fondement-legal/" },
] as const;

type Source = (typeof SOURCES)[number];
type SourceRead =
  | { ok: true; source: Source; finalUrl: string; httpStatus: number; contentHash: string; excerpt: string }
  | { ok: false; source: Source; error: string; httpStatus: number | null };

function readableText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

async function readSource(source: Source): Promise<SourceRead> {
  try {
    const response = await fetch(source.url, {
      headers: { "user-agent": "MAGNISA-RegulatoryWatch/1.1 (+official-source-change-monitor)", accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(20000), cache: "no-store", redirect: "follow",
    });
    if (!response.ok) return { ok: false, source, error: `HTTP ${response.status}`, httpStatus: response.status };
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return { ok: false, source, error: `Type de contenu inattendu : ${contentType || "inconnu"}`, httpStatus: response.status };
    }
    const body = await response.text();
    if (body.length > 5_000_000) return { ok: false, source, error: "Page supérieure à la limite de 5 Mo", httpStatus: response.status };
    const text = readableText(body);
    if (text.length < 100) return { ok: false, source, error: "Contenu lisible vide ou trop court", httpStatus: response.status };
    return { ok: true, source, finalUrl: response.url, httpStatus: response.status,
      contentHash: createHash("sha256").update(text).digest("hex"), excerpt: text.slice(0, 3000) };
  } catch (error) {
    return { ok: false, source, error: error instanceof Error ? error.message.slice(0, 500) : "Source inaccessible", httpStatus: null };
  }
}

export async function GET(request: Request) {
  const authError = getCronAuthorizationError(process.env.CRON_SECRET, request.headers.get("authorization"));
  if (authError === 503) return NextResponse.json({ error: "Cron authentication is not configured" }, { status: 503 });
  if (authError === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const supabase = createAdminClient();
    const [{ data: organizations, error: orgError }, { data: settings, error: settingsError }, { data: sourceSettings, error: sourceSettingsError }] = await Promise.all([
      supabase.from("organizations").select("id"),
      supabase.from("regulatory_watch_settings").select("organization_id,enabled"),
      supabase.from("regulatory_watch_source_settings").select("organization_id,source_key,enabled"),
    ]);
    if (orgError) throw orgError;
    if (settingsError) throw settingsError;
    if (sourceSettingsError) throw sourceSettingsError;

    const enabledByOrg = new Map((settings || []).map((row: any) => [row.organization_id, row.enabled]));
    const activeOrganizations = (organizations || []).filter((org: any) => enabledByOrg.get(org.id) !== false);
    if (!activeOrganizations.length) {
      return NextResponse.json({ ok: true, organizations: 0, sources_checked: 0, changes_detected: 0, failures: 0, skipped: "Surveillance désactivée pour toutes les organisations." });
    }

    const sourceEnabledByOrg = new Map<string, Set<string>>();
    for (const org of activeOrganizations as Array<{ id: string }>) {
      const rows = (sourceSettings || []).filter((row: any) => row.organization_id === org.id);
      const enabled = new Set(rows.filter((row: any) => row.enabled !== false).map((row: any) => row.source_key as string));
      if (!rows.length) for (const source of SOURCES) enabled.add(source.key);
      sourceEnabledByOrg.set(org.id, enabled);
    }
    const sourcesToFetch = SOURCES.filter(source =>
      activeOrganizations.some((org: any) => sourceEnabledByOrg.get(org.id)?.has(source.key)),
    );

    const runByOrg = new Map<string, { id: string; checked: number; changes: number; failures: number; errors: string[] }>();
    const startedAt = new Date().toISOString();
    for (const org of activeOrganizations as Array<{ id: string }>) {
      const { data: run, error } = await supabase.from("regulatory_watch_runs").insert({
        organization_id: org.id, started_at: startedAt, status: "running",
      }).select("id").single();
      if (error || !run) throw error || new Error("Impossible d'ouvrir le journal de surveillance.");
      runByOrg.set(org.id, { id: run.id, checked: 0, changes: 0, failures: 0, errors: [] });
    }

    const results = await Promise.all(sourcesToFetch.map(readSource));
    for (const result of results) {
      for (const org of activeOrganizations as Array<{ id: string }>) {
        if (!sourceEnabledByOrg.get(org.id)?.has(result.source.key)) continue;
        const run = runByOrg.get(org.id)!;
        const attemptedAt = new Date().toISOString();

        if (!result.ok) {
          run.failures++;
          run.errors.push(`${result.source.key}: ${result.error}`);
          await supabase.from("regulatory_watch_source_settings").update({
            last_attempt_at: attemptedAt, last_http_status: result.httpStatus, last_error: result.error,
          }).eq("organization_id", org.id).eq("source_key", result.source.key);
          continue;
        }

        const { data: previous, error: readError } = await supabase.from("regulatory_source_snapshots")
          .select("content_hash,content_excerpt").eq("organization_id", org.id)
          .eq("source_key", result.source.key).maybeSingle();
        if (readError) {
          run.failures++;
          run.errors.push(`${result.source.key}: lecture snapshot impossible`);
          continue;
        }

        run.checked++;
        await supabase.from("regulatory_watch_source_settings").update({
          last_attempt_at: attemptedAt, last_success_at: attemptedAt,
          last_http_status: result.httpStatus, last_error: null,
        }).eq("organization_id", org.id).eq("source_key", result.source.key);

        if (!previous) {
          const { error } = await supabase.from("regulatory_source_snapshots").insert({
            organization_id: org.id, source_key: result.source.key, source_title: result.source.title,
            source_url: result.source.url, content_hash: result.contentHash,
            content_excerpt: result.excerpt, last_checked_at: attemptedAt, last_changed_at: null,
            last_http_status: result.httpStatus,
          });
          if (error) { run.failures++; run.errors.push(`${result.source.key}: initialisation snapshot impossible`); }
          continue;
        }

        if (previous.content_hash !== result.contentHash) {
          const { data: event, error: eventError } = await supabase.from("regulatory_watch_events").insert({
            organization_id: org.id, source_key: result.source.key, source_title: result.source.title,
            source_url: result.source.url, source_final_url: result.finalUrl,
            previous_hash: previous.content_hash, current_hash: result.contentHash,
            previous_excerpt: previous.content_excerpt, current_excerpt: result.excerpt,
            http_status: result.httpStatus,
          }).select("id").single();
          if (eventError && eventError.code !== "23505") {
            run.failures++; run.errors.push(`${result.source.key}: enregistrement du changement impossible`); continue;
          }
          const { error: snapshotError } = await supabase.from("regulatory_source_snapshots").update({
            source_title: result.source.title, source_url: result.source.url,
            content_hash: result.contentHash, content_excerpt: result.excerpt,
            last_checked_at: attemptedAt, last_changed_at: attemptedAt, last_http_status: result.httpStatus,
          }).eq("organization_id", org.id).eq("source_key", result.source.key);
          if (snapshotError) { run.failures++; run.errors.push(`${result.source.key}: mise à jour snapshot impossible`); continue; }

          if (event?.id) {
            const { data: members, error: memberError } = await supabase.from("organization_members")
              .select("user_id").eq("organization_id", org.id).eq("status", "active")
              .in("role", ["owner", "admin", "director", "finance_manager", "accountant", "hr"]);
            if (memberError) { run.failures++; run.errors.push(`${result.source.key}: lecture des destinataires impossible`); }
            else if (members?.length) {
              const notifications = members.map((member: any) => ({
                organization_id: org.id, recipient_user_id: member.user_id, category: "tax",
                priority: "attention", title: "Source réglementaire mise à jour",
                body: `${result.source.title} a changé depuis le dernier contrôle. Vérifie le texte officiel : ce changement de contenu ne prouve pas à lui seul une modification de la loi.`,
                action_url: "/paie/veille-reglementaire", entity_type: "regulatory_watch_event",
                entity_id: event.id, metadata: { source_key: result.source.key, source_url: result.source.url },
                dedupe_key: `regulatory-source-change:${result.source.key}:${result.contentHash}`,
              }));
              const { error: notificationError } = await supabase.from("notifications").upsert(notifications, {
                onConflict: "organization_id,recipient_user_id,dedupe_key", ignoreDuplicates: true,
              });
              if (notificationError) { run.failures++; run.errors.push(`${result.source.key}: notification non enregistrée`); }
            }
            run.changes++;
          }
        } else {
          const { error } = await supabase.from("regulatory_source_snapshots").update({
            last_checked_at: attemptedAt, last_http_status: result.httpStatus,
          }).eq("organization_id", org.id).eq("source_key", result.source.key);
          if (error) { run.failures++; run.errors.push(`${result.source.key}: mise à jour de la date de contrôle impossible`); }
        }
      }
    }

    const finishedAt = new Date().toISOString();
    for (const [organizationId, run] of runByOrg) {
      const status = run.checked === 0 && run.failures === 0 ? "skipped"
        : run.failures === 0 ? "success" : run.checked > 0 ? "partial" : "failed";
      await supabase.from("regulatory_watch_runs").update({
        finished_at: finishedAt, status, sources_checked: run.checked,
        changes_detected: run.changes, errors: run.errors,
      }).eq("id", run.id).eq("organization_id", organizationId);
    }

    const checked = [...runByOrg.values()].reduce((sum, run) => sum + run.checked, 0);
    const changes = [...runByOrg.values()].reduce((sum, run) => sum + run.changes, 0);
    const failures = [...runByOrg.values()].reduce((sum, run) => sum + run.failures, 0);
    return NextResponse.json({
      ok: failures === 0, organizations: activeOrganizations.length,
      sources_checked: checked, changes_detected: changes, failures,
      source_errors: results.filter((item): item is Extract<SourceRead, { ok: false }> => !item.ok)
        .map(item => ({ source: item.source.key, error: item.error, http_status: item.httpStatus })),
      note: "Une modification de contenu crée une alerte à examiner ; aucun taux de paie n'est modifié automatiquement.",
    }, { status: failures ? 207 : 200 });
  } catch (error) {
    console.error("regulatory watch cron failed", error);
    return NextResponse.json({ error: "Regulatory monitoring failed" }, { status: 500 });
  }
}
