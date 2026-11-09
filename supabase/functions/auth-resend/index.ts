import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// This placeholder does not implement resend and is not referenced by MAGNISA.
// Keep the unused endpoint closed until a real, reviewed resend workflow exists.
Deno.serve(() => new Response("Not found", {
  status: 404,
  headers: { "Cache-Control": "no-store" },
}));
