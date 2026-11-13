type LogoSource = {
  logo_url?: string | null;
  logo_storage_path?: string | null;
  logo_inverse_storage_path?: string | null;
  document_theme?: unknown;
};

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

function usesDarkBackground(sources: LogoSource[]): boolean {
  return sources.some(source => {
    const theme = source.document_theme;
    if(!theme || typeof theme!=="object" || Array.isArray(theme))return false;
    const value=(theme as Record<string,unknown>).backgroundColor;
    if(typeof value!=="string" || !/^#[a-fA-F0-9]{6}$/.test(value))return false;
    const red=parseInt(value.slice(1,3),16);
    const green=parseInt(value.slice(3,5),16);
    const blue=parseInt(value.slice(5,7),16);
    return (red*.2126 + green*.7152 + blue*.0722) < 120;
  });
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
  const useInverse=usesDarkBackground(sources);
  for (const source of sources) {
    const legacyUrl = source.logo_url?.trim() || "";
    const colorPath = source.logo_storage_path?.trim() || pathFromBrandingUrl(legacyUrl);
    const inversePath = useInverse ? source.logo_inverse_storage_path?.trim() : null;
    const paths = [...new Set([inversePath,colorPath].filter((p):p is string=>!!p))];

    for (const path of paths) {
      const { data, error } = await supabase.storage
        .from(PRIVATE_BRANDING_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (!error && data?.signedUrl) return data.signedUrl;
    }
    // Never treat a private-bucket URL as an external public fallback.
    if (legacyUrl && !pathFromBrandingUrl(legacyUrl)) return legacyUrl;
  }

  return null;
}
