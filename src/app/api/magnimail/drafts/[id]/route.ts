import { NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { mailProviderHttpError, resolveUserMailProvider } from "@/lib/magnimail/providers/resolve";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id || id.length > 512) {
      return NextResponse.json({ error: "Identifiant de brouillon invalide." }, { status: 400 });
    }

    const ctx = await requireOrganization();
    const connectionId = new URL(request.url).searchParams.get("connectionId");
    const { provider, context } = await resolveUserMailProvider(ctx, connectionId);

    if (!provider.capabilities.drafts) {
      return NextResponse.json({ error: "Ce fournisseur ne gère pas les brouillons." }, { status: 501 });
    }

    await provider.deleteDraft({ context, draftId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("MGMail delete draft failed", error);
    const detail = mailProviderHttpError(error);
    return NextResponse.json({ error: detail.error }, { status: detail.status });
  }
}
