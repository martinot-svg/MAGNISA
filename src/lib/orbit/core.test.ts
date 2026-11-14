import { describe, expect, it } from "vitest";
import {
  canUseMagniboxMailbox,
  isConfirmedMagniboxDelivery,
  isFinalMagniboxDeliveryState,
} from "./core";

const mailbox = {
  id: "mailbox-1",
  organizationId: "org-a",
  kind: "shared" as const,
  active: true,
};
const context = {
  userId: "user-a",
  organizationId: "org-a",
  activeOrganizationMember: true,
  grant: { active: true, canRead: true, canSend: false, canManage: false },
};

describe("MAGNIBOX Core contracts", () => {
  it("requires an active membership and an explicit active grant", () => {
    expect(canUseMagniboxMailbox(mailbox, context, "read")).toBe(true);
    expect(canUseMagniboxMailbox(mailbox, context, "send")).toBe(false);
    expect(canUseMagniboxMailbox(mailbox, { ...context, activeOrganizationMember: false }, "read")).toBe(false);
    expect(canUseMagniboxMailbox(mailbox, { ...context, grant: null }, "read")).toBe(false);
    expect(canUseMagniboxMailbox(mailbox, {
      ...context, grant: { ...context.grant, active: false },
    }, "read")).toBe(false);
  });

  it("rejects cross-organization and inactive mailbox access", () => {
    expect(canUseMagniboxMailbox(mailbox, {
      ...context, organizationId: "org-b",
    }, "read")).toBe(false);
    expect(canUseMagniboxMailbox({ ...mailbox, active: false }, context, "read")).toBe(false);
  });

  it("does not confuse provider acceptance with confirmed delivery", () => {
    expect(isFinalMagniboxDeliveryState("accepted")).toBe(false);
    expect(isFinalMagniboxDeliveryState("uncertain")).toBe(false);
    expect(isFinalMagniboxDeliveryState("delivered")).toBe(true);
    expect(isConfirmedMagniboxDelivery("accepted")).toBe(false);
    expect(isConfirmedMagniboxDelivery("delivered")).toBe(true);
  });
});
