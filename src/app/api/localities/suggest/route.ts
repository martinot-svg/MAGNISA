import { NextRequest, NextResponse } from "next/server";
import { suggestMadagascarLocalities } from "@/lib/geo/madagascar-localities";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const region = params.get("region") || "";
  const query = (params.get("q") || "").trim().slice(0,80);
  const results = suggestMadagascarLocalities(region, query);
  return NextResponse.json({ results }, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
