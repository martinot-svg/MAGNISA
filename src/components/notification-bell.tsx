"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ExternalLink } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  priority: "info" | "attention" | "urgent" | "critical";
  category: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

const priorityColor: Record<string, string> = {
  info: "#64748b",
  attention: "#d97706",
  urgent: "#ea580c",
  critical: "#dc2626",
};

export function NotificationBell({ userId, organizationId, initialUnread = 0 }: {
  userId: string;
  organizationId: string;
  initialUnread?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(initialUnread);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const supabase = supabaseBrowser();
    const { data } = await supabase
      .from("notifications")
      .select("id,title,body,priority,category,action_url,read_at,created_at")
      .eq("organization_id", organizationId)
      .eq("recipient_user_id", userId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(8);
    if (data) setItems(data as NotificationRow[]);

    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("recipient_user_id", userId)
      .is("archived_at", null)
      .is("read_at", null);
    setUnread(count ?? 0);
  }

  useEffect(() => {
    void refresh();
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`notifications-${organizationId}-${userId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `recipient_user_id=eq.${userId}`,
      }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [organizationId, userId]);

  async function markRead(id: string) {
    const supabase = supabaseBrowser();
    await supabase.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("id", id).eq("recipient_user_id", userId);
    await refresh();
  }

  async function openNotification(item: NotificationRow) {
    if (!item.read_at) await markRead(item.id);
    setOpen(false);
    if (item.action_url?.startsWith("/")) router.push(item.action_url);
    else router.push("/notifications");
  }

  async function markAllRead() {
    setLoading(true);
    const supabase = supabaseBrowser();
    await supabase.from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("recipient_user_id", userId)
      .is("read_at", null)
      .is("archived_at", null);
    await refresh();
    setLoading(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <button type="button" aria-label="Ouvrir les notifications" aria-expanded={open}
        onClick={() => { setOpen((v) => !v); if (!open) void refresh(); }}
        style={{ position: "relative", width: 42, height: 42, border: "1px solid var(--border, #e2e8f0)", borderRadius: 12, background: "var(--card, #fff)", color: "inherit", display: "grid", placeItems: "center", cursor: "pointer" }}>
        <Bell size={19} />
        {unread > 0 && <span style={{ position: "absolute", top: -5, right: -5, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 20, background: "#dc2626", color: "#fff", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center" }}>{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && <div role="dialog" aria-label="Notifications récentes" style={{ position: "absolute", zIndex: 80, right: 0, top: 50, width: "min(380px, calc(100vw - 28px))", background: "var(--card, #fff)", border: "1px solid var(--border, #e2e8f0)", borderRadius: 16, boxShadow: "0 18px 48px rgba(15,23,42,.16)", overflow: "hidden", color: "var(--foreground, #0f172a)" }}>
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
          <strong style={{ fontSize: 14 }}>Notifications {unread > 0 ? `(${unread})` : ""}</strong>
          <button type="button" disabled={loading || unread === 0} onClick={() => void markAllRead()} style={{ border: 0, background: "transparent", color: "var(--primary, #2563eb)", fontSize: 12, cursor: "pointer" }}>Tout lire</button>
        </div>
        <div style={{ maxHeight: 390, overflowY: "auto" }}>
          {items.length === 0 ? <div style={{ padding: 28, textAlign: "center", color: "#64748b", fontSize: 13 }}>Aucune notification pour le moment.</div> :
            items.map((item) => <button type="button" key={item.id} onClick={() => void openNotification(item)} style={{ display: "block", width: "100%", textAlign: "left", padding: "13px 16px", border: 0, borderBottom: "1px solid var(--border, #e2e8f0)", background: item.read_at ? "transparent" : "rgba(37,99,235,.045)", cursor: "pointer", color: "inherit" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {!item.read_at && <span style={{ width: 7, height: 7, borderRadius: 20, background: "#2563eb" }} />}
                <strong style={{ fontSize: 13, flex: 1 }}>{item.title}</strong>
                <span style={{ width: 7, height: 7, borderRadius: 20, background: priorityColor[item.priority] }} />
              </span>
              <span style={{ display: "block", fontSize: 12, color: "var(--muted-foreground, #64748b)", lineHeight: 1.45, marginTop: 5 }}>{item.body}</span>
              <span style={{ display: "block", fontSize: 10, color: "#94a3b8", marginTop: 6 }}>{new Date(item.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Indian/Antananarivo" })}</span>
            </button>)}
        </div>
        <Link href="/notifications" onClick={() => setOpen(false)} style={{ padding: 13, display: "flex", justifyContent: "center", gap: 7, color: "var(--primary, #2563eb)", textDecoration: "none", fontSize: 12, fontWeight: 650 }}>
          Voir toutes les notifications <ExternalLink size={13} />
        </Link>
      </div>}
    </div>
  );
}
