import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("MAGNISA organization invitations", () => {
  const page = readFileSync("src/app/espace-personnel/page.tsx", "utf8");
  const edge = readFileSync("supabase/functions/invite-user/index.ts", "utf8");

  it("never activates an organization membership when an invite is sent", () => {
    expect(edge).toContain('status: "invited"');
    expect(edge).not.toContain('status: "active"');
    expect(edge).toContain("emailSent: invitationEmailSent");
  });

  it("provides an invitation inbox and explicit accept/refuse actions", () => {
    expect(page).toContain('rpc("get_my_organization_invitations")');
    expect(page).toContain('rpc("respond_to_organization_invitation"');
    expect(page).toContain('name="accept" value="true"');
    expect(page).toContain('name="accept" value="false"');
    expect(page).toContain("Accepter");
    expect(page).toContain("Refuser");
  });
});
