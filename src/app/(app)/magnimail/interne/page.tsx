import { MagniboxInternalContent } from "@/components/magnimail-internal-workspace";

/** Compatibility URL for the internal area of the single Magnibox workspace. */
export default async function MagniboxInternalPage({ searchParams }: { searchParams?: Promise<{ q?: string | string[] }> }) {
  const params = searchParams ? await searchParams : {};
  const searchQuery = Array.isArray(params.q) ? (params.q[0] || "") : (params.q || "");
  return <MagniboxInternalContent searchQuery={searchQuery} />;
}
