/**
 * Assertions de cohérence inter-tenant pour les services métier.
 *
 * Important : cette fonction ne remplace ni requireOrganization, ni les
 * permissions, ni RLS. L'organisation autorisée doit être déterminée côté
 * serveur avant d'appeler ce contrôle.
 */
export function assertSameOrganization(
  activeOrganizationId: string,
  resourceOrganizationId: string,
): void {
  if (
    !activeOrganizationId ||
    !resourceOrganizationId ||
    activeOrganizationId !== resourceOrganizationId
  ) {
    throw new Error("Ressource inaccessible pour cette organisation.");
  }
}
