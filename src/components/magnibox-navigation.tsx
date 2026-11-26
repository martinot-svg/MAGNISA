"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Mail, Mailbox, Settings2, Globe2, LayoutDashboard } from "lucide-react";

const items = [
  { href: "/orbit/magnibox", label: "Accueil", icon: LayoutDashboard, exact: true },
  { href: "/orbit/magnibox/messagerie", label: "Messagerie", icon: Mail },
  { href: "/orbit/magnibox/boites", label: "Boîtes & collaborateurs", icon: Mailbox },
  { href: "/orbit/magnibox/courrier", label: "Courrier professionnel", icon: Globe2 },
  { href: "/orbit/magnibox/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/orbit/magnibox/administration", label: "Administration", icon: Settings2 },
];

export function MagniboxNavigation() {
  const pathname = usePathname();
  return (
    <nav className="mg-nav" aria-label="Navigation MAGNIBOX">
      <div className="mg-nav-heading">
        <span className="mg-nav-mark" aria-hidden="true">M</span>
        <div><strong>MAGNIBOX</strong><small>Communication professionnelle</small></div>
      </div>
      <div className="mg-nav-links">
        {items.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href} className={active ? "mg-nav-link active" : "mg-nav-link"} aria-current={active ? "page" : undefined}>
              <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
