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

async function readSource(source: (typeof SOURCES)[number]) {
  const response = await fetch(source.url, {
    headers: { "user-agent": "MAGNISA-RegulatoryWatch/1.0 (+official-source-change-monitor)" },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${source.key}: HTTP ${response.status}`);
  const body = await response.text();
  if (!body || body.length < 100) throw new Error(`${source.key}: contenu source vide ou trop court`);
  const contentHash = createHash("sha256").update(body).digest("hex");
  return { ...source, finalUrl: response.url, contentHash };
}

export async function GET(request: Request) {
  const authError = getCronAuthorizationError(
    process.env.CRON_SECRET,
    request.headers.get("authorization"),
  );
  if (authError === 503) return NextResponse.json({ error: "Cron authentication is not configured" }, { status: 503 });
  if (authError === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const supabase = createAdminClient();
    const [{ data: organizations, error: orgError }, sourceResults] = await Promise.all([
      supabase.from("organizations").select("id"),
      Promise.all(SOURCES.map(async (source) => {
        try { return { ok: true as const, source: await readSource(source) }; }
        catch (error) { return { ok: false as const, key: source.key, error: error instanceof Error ? error.message : "Source inaccessible" }; }
      })),
    ]);
    if (orgError) throw orgError;

    const settingsResult = await supabase.from("regulatory_watch_settings").select("organization_id,enabled");
    if (settingsResult.error) throw settingsResult.error;
    const enabledByOrg = new Map((settingsResult.data || []).map((row: any) => [row.organization_id, row.enabled]));
    const activeOrganizations = (organizations || []).filter((org: any) => enabledByOrg.get(org.id) !== false);

    let initialized = 0;
    let changes = 0;
    let failures = 0;
    for (const result of sourceResults) {
      if (!result.ok) { failures++; continue; }
      const source = result.source;
      for (const org of activeOrganizations as Array<{ id: string }>) {
        const { data: previous, error: readError } = await supabase
          .from("regulatory_source_snapshots")
          .select("content_hash")
          .eq("organization_id", org.id)
          .eq("source_key", source.key)
          .maybeSingle();
        if (readError) { failures++; continue; }

        if (!previous) {
          const { error } = await supabase.from("regulatory_source_snapshots").insert({
            organization_id: org.id, source_key: source.key, source_title: source.title,
            source_url: source.url, content_hash: source.contentHash, last_checked_at: new Date().toISOString(),
          });
          if (error) failures++; else initialized++;
          continue;
        }

        if (previous.content_hash !== source.contentHash) {
          const { data: event, error: eventError } = await supabase.from("regulatory_watch_events").insert({
            organization_id: org.id, source_key: source.key, source_title: source.title,
            source_url: source.url, previous_hash: previous.content_hash, current_hash: source.contentHash,
          }).select("id").single();
          if (eventError && eventError.code !== "23505") { failures++; continue; }
          await supabase.from("regulatory_source_snapshots").update({
            source_title: source.title, source_url: source.url, content_hash: source.contentHash,
            last_checked_at: new Date().toISOString(), last_changed_at: new Date().toISOString(),
          }).eq("organization_id", org.id).eq("source_key", source.key);

          if (event?.id) {
            const { data: members } = await supabase.from("organization_members")
              .select("user_id").eq("organization_id", org.id).eq("status", "active")
              .in("role", ["owner", "admin", "director", "finance_manager", "accountant", "hr"]);
            if (members?.length) {
              const notifications = members.map((member: any) => ({
                organization_id: org.id, recipient_user_id: member.user_id, category: "tax",
                priority: "attention", title: "Source réglementaire mise à jour",
                body: `${source.title} a changé depuis le dernier contrôle. Vérifie le texte officiel : ce changement de page ne prouve pas à lui seul une modification de la loi.`,
                action_url: "/paie/veille-reglementaire", entity_type: "regulatory_watch_event",
                entity_id: event.id, metadata: { source_key: source.key, source_url: source.url },
                dedupe_key: `regulatory-source-change:${source.key}:${source.contentHash}`,
              }));
              const { error: notificationError } = await supabase.from("notifications").upsert(notifications, {
                onConflict: "organization_id,recipient_user_id,dedupe_key", ignoreDuplicates: true,
              });
              if (notificationError) failures++;
            }
            changes++;
          }
        } else {
          const { error } = await supabase.from("regulatory_source_snapshots").update({
            last_checked_at: new Date().toISOString(),
          }).eq("organization_id", org.id).eq("source_key", source.key);
          if (error) failures++;
        }
      }
    }

    return NextResponse.json({
      ok: failures === 0, organizations: activeOrganizations.length,
      sources_checked: sourceResults.filter((item) => item.ok).length,
      snapshots_initialized: initialized, changed_sources: changes, failures,
      source_errors: sourceResults.filter((item) => !item.ok),
      note: "A page-content change creates a review alert only; it never changes a payroll rate automatically.",
    }, { status: failures ? 207 : 200 });
  } catch (error) {
    console.error("regulatory watch cron failed", error);
    return NextResponse.json({ error: "Regulatory monitoring failed" }, { status: 500 });
  }
}
