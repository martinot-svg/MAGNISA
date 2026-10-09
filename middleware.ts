import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const protectedPrefixes = [
  "/dashboard", "/prospects", "/clients", "/services", "/projets", "/devis",
  "/commandes", "/factures", "/paiements", "/fournisseurs", "/depenses",
  "/tresorerie", "/dettes", "/comptes-associes", "/emprunts", "/paie",
  "/budget", "/analyse", "/fiscalite-social", "/comptabilite",
  "/etats-financiers", "/rapports", "/modeles-documents", "/utilisateurs",
  "/audit", "/parametres", "/onboarding"
];

function matchesPath(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );
  const pathname = request.nextUrl.pathname;
  const protectedRoute = protectedPrefixes.some((prefix) => matchesPath(pathname, prefix));
  if (!protectedRoute) return response;

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // An unverified account must never access tenant business data.
  if (!user.email_confirmed_at) {
    const url = request.nextUrl.clone();
    url.pathname = "/verify-email";
    if (user.email) url.searchParams.set("email", user.email);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
