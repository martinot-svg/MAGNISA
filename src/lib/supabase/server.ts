import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => { try { items.forEach(({name,value,options}) => cookieStore.set(name,value,options)); } catch (error) { if (process.env.CI === "true") console.error("[supabase-cookie-refresh] failed", String(error)); } }
    }
  });
}
