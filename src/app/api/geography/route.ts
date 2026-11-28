import { NextRequest, NextResponse } from "next/server";
import { getCities, getStatesByShort } from "countrycitystatejson";
import { REGISTRATION_REGIONS } from "@/lib/auth/magnisa-identity";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const country = (params.get("country") || "").trim().toUpperCase();
  const kind = params.get("kind");
  if (!/^[A-Z]{2}$/.test(country) || !["regions", "cities"].includes(kind || "")) {
    return NextResponse.json({ results: [], coverage: false }, { status: 400 });
  }

  if (kind === "regions") {
    if (country === "MG") {
      return NextResponse.json({
        results: REGISTRATION_REGIONS.map((item) => ({ code: item.code, name: item.name })),
        coverage: true,
      }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
    }
    const states = getStatesByShort(country);
    return NextResponse.json({
      results: (states || []).map((name) => ({ code: name, name })),
      coverage: states !== null,
    }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  }

  const region = (params.get("region") || "").trim().slice(0, 120);
  const query = (params.get("q") || "").trim().slice(0, 80);
  if (!region || query.length < 2 || country === "MG") {
    return NextResponse.json({ results: [], coverage: country !== "MG" });
  }
  const cities = getCities(country, region);
  if (cities === null) {
    return NextResponse.json({ results: [], coverage: false });
  }
  const needle = query.toLocaleLowerCase();
  const results = cities
    .filter((name) => name.toLocaleLowerCase().includes(needle))
    .slice(0, 30)
    .map((name) => ({ ref: "global", name, type: "city", commune: name, district: region }));
  return NextResponse.json({ results, coverage: true }, {
    headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=1800" },
  });
}
