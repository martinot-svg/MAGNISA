import { MagniboxSyncError } from "./imap-sync-core";

/**
 * MAGNIBOX internal address convention:
 *   <mailbox local_part>@<organization namespace slug>.magnibox
 *
 * The .magnibox namespace is private to MAGNISA. It is not an Internet domain
 * and must never be used as a public SMTP destination.
 */
export function formatMagniboxInternalAddress(input: {
  localPart: string;
  namespaceSlug: string;
}): string {
  const { localPart, namespaceSlug } = input;
  if (
    typeof localPart !== "string" ||
    !/^[a-z][a-z0-9._-]{1,63}$/.test(localPart) ||
    typeof namespaceSlug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(namespaceSlug) ||
    namespaceSlug.length < 2 ||
    namespaceSlug.length > 45
  ) {
    throw new MagniboxSyncError("Invalid MAGNIBOX internal address components", false);
  }

  const address = `${localPart}@${namespaceSlug}.magnibox`;
  if (address.length > 119) {
    throw new MagniboxSyncError("MAGNIBOX internal address is too long", false);
  }
  return address;
}

/** RFC 5322 addr-spec validation for addresses produced by the convention. */
export function isMagniboxInternalAddress(value: string): boolean {
  if (typeof value !== "string" || value.length > 119) return false;
  const match = /^([a-z][a-z0-9._-]{1,63})@([a-z0-9]+(?:-[a-z0-9]+)*)\.mgmail$/.exec(value);
  if (!match) return false;
  return match[2]!.length >= 2 && match[2]!.length <= 45;
}
