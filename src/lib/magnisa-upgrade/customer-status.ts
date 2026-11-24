export type CustomerStatus = "active" | "suspended" | "archived";

export function canCreateCommercialDocument(status: CustomerStatus): boolean {
  return status === "active";
}
