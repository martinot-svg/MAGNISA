import Link from "next/link";

const modules = [
  { href: "/orbit", name: "Orbit" },
  { href: "/orbit/magnibox", name: "Magnibox" },
  { href: "/orbit/planner", name: "Magnisa Planner" },
  { href: "/orbit/time", name: "Magnisa Time" },
  { href: "/orbit/action", name: "Magnisa Action" },
] as const;

/** Reuses the authenticated MAGNISA AppShell; no second login or tenant system. */
export default function OrbitLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="card section" aria-label="Navigation Magnisa Orbit">
        <div className="actions" style={{ flexWrap: "wrap" }}>
          {modules.map(module => (
            <Link key={module.href} className="button" href={module.href}>{module.name}</Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
