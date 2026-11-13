"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Bell, BarChart3, CircleDollarSign, ChevronRight, FileText, LayoutDashboard, Menu, Package, PanelLeftClose, PanelLeftOpen, Settings2, ShoppingCart, Users, Wallet, X } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

export type WorkspaceLink = { key: string; label: string; href: string; group: string };
function iconFor(key: string) {
  if (key === "dashboard") return LayoutDashboard;
  if (["clients","prospects","users","payroll","commissions"].includes(key)) return Users;
  if (["invoices","quotes","reports","financial_statements","document_templates"].includes(key)) return FileText;
  if (["suppliers","orders","procurement","customer_mandates"].includes(key)) return ShoppingCart;
  if (["inventory","stock_operations","services"].includes(key)) return Package;
  if (["treasury","payments","debts","loans","partner_accounts"].includes(key)) return Wallet;
  if (["accounting","immobilisations","expenses","tax_social","fiscal_years"].includes(key)) return CircleDollarSign;
  if (["settings","audit"].includes(key)) return Settings2;
  if (key === "notifications") return Bell;
  return BarChart3;
}

/** Navigation uniquement : autorisations et modules actifs restent calculés côté serveur. */
export function AppWorkspace({ links, notifications, signOut, children }: {
  links: WorkspaceLink[];
  notifications: ReactNode;
  signOut: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const refresh = () => { setNarrow(media.matches); if (!media.matches) setOpen(false); };
    refresh();
    media.addEventListener("change", refresh);
    return () => media.removeEventListener("change", refresh);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!narrow || !open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        menuButton.current?.focus();
      }
      if (event.key === "Tab" && navigation.current) {
        const nodes = Array.from(navigation.current.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)'));
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [narrow, open]);

  let previousGroup = "";
  return (
    <MotionConfig reducedMotion="user">
      <div className={"appShell mg-app" + (collapsed ? " mg-collapsed" : "") + (open ? " mg-drawer-open" : "")}>
        <AnimatePresence>
          {narrow && open ? (
            <motion.button key="backdrop" className="mg-backdrop" type="button"
              aria-label="Fermer la navigation" onClick={() => setOpen(false)}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : .18 }} />
          ) : null}
        </AnimatePresence>
        <aside className="mg-sidebar" id="mg-nav" ref={navigation} aria-label="Navigation des modules"
          inert={narrow && !open}>
          <div className="mg-brand-row">
            <BrandMark href="/dashboard" compact />
            <button type="button" className="mg-icon-button mg-collapse-trigger"
              aria-label={collapsed ? "Développer la navigation" : "Réduire la navigation"}
              title={collapsed ? "Développer la navigation" : "Réduire la navigation"}
              aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)}>
              {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </button>
            <button type="button" className="mg-icon-button mg-drawer-close" ref={closeButton}
              aria-label="Fermer le menu" onClick={() => { setOpen(false); menuButton.current?.focus(); }}><X size={20} /></button>
          </div>
          <nav aria-label="Modules MAGNISA">
            {links.map(link => {
              const newGroup = link.group !== previousGroup;
              previousGroup = link.group;
              const Icon = iconFor(link.key);
              const active = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href + "/"));
              return (
                <div key={link.key} className="mg-nav-row">
                  {newGroup ? <div className="mg-nav-group">{link.group}</div> : null}
                  <Link href={link.href} className="mg-nav-link" aria-current={active ? "page" : undefined}
                    title={collapsed && !narrow ? link.label : undefined} onClick={() => setOpen(false)}>
                    <Icon size={18} aria-hidden="true" />
                    <span className="mg-nav-label">{link.label}</span>
                    {active ? <ChevronRight size={14} className="mg-nav-chevron" aria-hidden="true" /> : null}
                  </Link>
                </div>
              );
            })}
          </nav>
          <div className="mg-sidebar-footer">{signOut}</div>
        </aside>
        <main className="mg-main" id="contenu-principal">
          <header className="mg-topbar">
            <div className="mg-topbar-left">
              <button type="button" className="mg-icon-button mg-menu-trigger" ref={menuButton}
                aria-label="Ouvrir le menu des modules" aria-controls="mg-nav" aria-expanded={open}
                onClick={() => setOpen(true)}><Menu size={21} /></button>
              <div className="mg-topbar-title"><small>MAGNISA</small><strong>Espace de travail</strong></div>
            </div>
            <div className="mg-topbar-right">
              <Link className="mg-topbar-link" href="/dashboard">Tableau de bord</Link>
              {notifications}
            </div>
          </header>
          <motion.div className="mg-content" initial={false}
            animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : .18 }}>
            {children}
          </motion.div>
        </main>
      </div>
    </MotionConfig>
  );
}
