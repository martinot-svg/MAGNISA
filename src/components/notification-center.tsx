"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, Archive, ArrowUpRight, Filter } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

type NotificationRow = {
  id: string; title: string; body: string; priority: string; category: string;
  action_url: string | null; read_at: string | null; archived_at: string | null; created_at: string;
};

const categoryLabels: Record<string, string> = {
  finance: "Finance", loan: "Emprunts", payment: "Paiements", treasury: "Trésorerie",
  social: "Social", tax: "Fiscalité", service: "Services", accounting: "Comptabilité", system: "Système",
};
const priorityLabels: Record<string, string> = {
  info: "Information", attention: "Attention", urgent: "Urgent", critical: "Critique",
};
const priorityColors: Record<string, string> = {
  info: "#64748b", attention: "#d97706", urgent: "#ea580c", critical: "#dc2626",
};

export function NotificationCenter({ userId, organizationId }: { userId: string; organizationId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [filter, setFilter] = useState<"all" | "unread" | "archived">("all");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const supabase = supabaseBrowser();
    let query = supabase.from("notifications")
      .select("id,title,body,priority,category,action_url,read_at,archived_at,created_at")
      .eq("organization_id", organizationId).eq("recipient_user_id", userId)
      .order("created_at", { ascending: false }).limit(100);
    if (filter === "archived") query = query.not("archived_at", "is", null);
    else query = query.is("archived_at", null);
    if (filter === "unread") query = query.is("read_at", null);
    const { data } = await query;
    setItems((data ?? []) as NotificationRow[]);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, [organizationId, userId, filter]);

  const unreadCount = useMemo(() => items.filter((item) => !item.read_at && !item.archived_at).length, [items]);

  async function updateOne(id: string, values: { read_at?: string | null; archived_at?: string | null }) {
    const supabase = supabaseBrowser();
    await supabase.from("notifications").update(values).eq("id", id).eq("recipient_user_id", userId);
    await refresh();
  }

  async function markAllRead() {
    const supabase = supabaseBrowser();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("organization_id", organizationId).eq("recipient_user_id", userId)
      .is("read_at", null).is("archived_at", null);
    await refresh();
  }

  async function openItem(item: NotificationRow) {
    if (!item.read_at) await updateOne(item.id, { read_at: new Date().toISOString() });
    if (item.action_url?.startsWith("/")) router.push(item.action_url);
  }

  return (
    <section style={{ maxWidth: 980, margin: "0 auto", padding: "24px 20px 48px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}><Bell size={22} /><h1 style={{ margin: 0, fontSize: 25, fontWeight: 750 }}>Centre de notifications</h1></div>
          <p style={{ color: "var(--muted-foreground, #64748b)", margin: "7px 0 0", fontSize: 13 }}>Retrouve les alertes et les événements importants de ton entreprise.</p>
        </div>
        <button type="button" onClick={() => void markAllRead()} disabled={!unreadCount} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border, #e2e8f0)", background: "var(--card, #fff)", cursor: unreadCount ? "pointer" : "default", opacity: unreadCount ? 1 : .5 }}>
          <CheckCheck size={15} /> Tout marquer comme lu
        </button>
      </header>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 15 }}>
        <Filter size={15} color="#64748b" />
        {(["all", "unread", "archived"] as const).map((value) => <button type="button" key={value} onClick={() => setFilter(value)} style={{ borderRadius: 20, border: "1px solid var(--border, #e2e8f0)", background: filter === value ? "var(--primary, #2563eb)" : "var(--card, #fff)", color: filter === value ? "#fff" : "inherit", padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>{value === "all" ? "Toutes" : value === "unread" ? "Non lues" : "Archivées"}</button>)}
      </div>
      <div style={{ border: "1px solid var(--border, #e2e8f0)", borderRadius: 15, overflow: "hidden", background: "var(--card, #fff)" }}>
        {loading ? <p style={{ padding: 28, color: "#64748b", textAlign: "center" }}>Chargement des notifications...</p> :
          items.length === 0 ? <div style={{ padding: 45, textAlign: "center", color: "#64748b" }}><Bell size={25} style={{ margin: "0 auto 10px" }} /><strong style={{ display: "block", color: "inherit" }}>Aucune notification</strong><span style={{ fontSize: 13 }}>Les nouvelles alertes apparaîtront ici.</span></div> :
          items.map((item) => <article key={item.id} style={{ display: "flex", gap: 13, padding: "16px 18px", borderBottom: "1px solid var(--border, #e2e8f0)", background: item.read_at ? "transparent" : "rgba(37,99,235,.035)" }}>
            <span style={{ flex: "0 0 9px", width: 9, height: 9, borderRadius: 20, marginTop: 6, background: item.read_at ? "#cbd5e1" : "#2563eb" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7 }}>
                <strong style={{ fontSize: 14 }}>{item.title}</strong>
                <span style={{ fontSize: 10, color: priorityColors[item.priority] ?? "#64748b", border: "1px solid currentColor", borderRadius: 20, padding: "2px 7px" }}>{priorityLabels[item.priority] ?? item.priority}</span>
                <span style={{ fontSize: 10, color: "#64748b" }}>{categoryLabels[item.category] ?? item.category}</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--muted-foreground, #64748b)", lineHeight: 1.5, margin: "6px 0" }}>{item.body}</p>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{new Date(item.created_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Indian/Antananarivo" })}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {item.action_url && <button type="button" title="Ouvrir le dossier" onClick={() => void openItem(item)} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 7 }}><ArrowUpRight size={17} /></button>}
              {!item.read_at && <button type="button" title="Marquer comme lu" onClick={() => void updateOne(item.id, { read_at: new Date().toISOString() })} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 7 }}><Check size={16} /></button>}
              {filter !== "archived" && <button type="button" title="Archiver" onClick={() => void updateOne(item.id, { archived_at: new Date().toISOString() })} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 7 }}><Archive size={16} /></button>}
              {filter === "archived" && <button type="button" title="Restaurer" onClick={() => void updateOne(item.id, { archived_at: null })} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 7 }}><Archive size={16} /></button>}
            </div>
          </article>)}
      </div>
    </section>
  );
}
