export function getCronAuthorizationError(
  configuredSecret: string | undefined,
  authorization: string | null,
): 401 | 503 | null {
  if (!configuredSecret) return 503;
  if (authorization !== `Bearer ${configuredSecret}`) return 401;
  return null;
}
