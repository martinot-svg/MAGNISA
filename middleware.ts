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
  if (!protectedPrefixes.some((prefix) => matchesPath(pathname, prefix))) return response;

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const {data:profile}=await supabase.from("profiles").select("account_status").eq("id",user.id).maybeSingle();

  if (!user.email_confirmed_at || profile?.account_status==="pending_verification") {
    const url = request.nextUrl.clone();
    url.pathname = "/verify-email";
    url.search = "";
    if (user.email) url.searchParams.set("email", user.email);
    return NextResponse.redirect(url);
  }

  if(profile?.account_status==="suspended"){
    const url=request.nextUrl.clone();
    url.pathname="/login";
    url.search="";
    url.searchParams.set("status","suspended");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
