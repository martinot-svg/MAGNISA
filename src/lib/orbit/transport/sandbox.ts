/**
 * Resend's automatically assigned *.resend.app domain is suitable only for
 * platform integration diagnostics, never for public tenant mailbox identity.
 * Sandbox webhooks do not read or write any tenant database rows.
 */
export function enabledResendSandboxDomain(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.MAGNIBOX_EXTERNAL_MAIL_ENABLED === "true"
      || env.MAGNIBOX_RESEND_SANDBOX_ENABLED !== "true") return null;
  const domain=(env.MAGNIBOX_RESEND_SANDBOX_DOMAIN || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}\.resend\.app$/.test(domain)) return null;
  return domain;
}

export function matchesResendSandboxDomain(recipients: string[], domain: string): boolean {
  if (!/^[a-z0-9][a-z0-9-]{1,62}\.resend\.app$/.test(domain)) return false;
  return recipients.length > 0 && recipients.length <= 50
    && recipients.every(address=>{
      const value=address.trim().toLowerCase();
      const parts=value.split("@");
      return parts.length===2 && /^[a-z0-9][a-z0-9.!#$%&'*+/=?^_`{|}~-]*$/.test(parts[0])
        && parts[1]===domain;
    });
}
