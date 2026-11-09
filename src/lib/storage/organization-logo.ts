type LogoSource = { logo_url?: string | null; logo_storage_path?: string | null };

const PRIVATE_BRANDING_BUCKET = "organization-branding";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function pathFromBrandingUrl(value: string): string | null {
  try {
    const pathname = new URL(value).pathname;
    for (const marker of [
      `/storage/v1/object/public/${PRIVATE_BRANDING_BUCKET}/`,
      `/storage/v1/object/sign/${PRIVATE_BRANDING_BUCKET}/`,
    ]) {
      const index = pathname.indexOf(marker);
      if (index >= 0) {
        const path = decodeURIComponent(pathname.slice(index + marker.length));
        return path || null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolve a company logo stored in the private branding bucket.
 * Legacy public URLs are parsed back into a Storage object path and re-signed.
 * External logo URLs remain usable, while missing private objects fail closed.
 */
export async function resolveOrganizationLogoUrl(
  supabase: any,
  ...sources: LogoSource[]
): Promise<string | null> {
  for (const source of sources) {
    const legacyUrl = source.logo_url?.trim() || "";
    const path = source.logo_storage_path?.trim() || pathFromBrandingUrl(legacyUrl);

    if (path) {
      const { data, error } = await supabase.storage
        .from(PRIVATE_BRANDING_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (!error && data?.signedUrl) return data.signedUrl;
      continue;
    }

    if (legacyUrl) return legacyUrl;
  }

  return null;
}
