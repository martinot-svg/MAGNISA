import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { deleteGmailDraft, getGmailAccess } from "@/lib/google/gmail";

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { organizationId, user } = await requireOrganization();
    const { accessToken } = await getGmailAccess(organizationId, user.id);
    await deleteGmailDraft(accessToken, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("MagniMail delete draft failed", error);
    const message = error instanceof Error ? error.message : "Suppression impossible.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
