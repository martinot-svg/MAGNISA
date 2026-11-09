import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// This temporary uploader is not referenced by MAGNISA and has no recent invocations.
// Keep the endpoint closed until a reviewed, authenticated upload workflow is implemented.
Deno.serve(() => new Response("Not found", {
  status: 404,
  headers: { "Cache-Control": "no-store" },
}));
