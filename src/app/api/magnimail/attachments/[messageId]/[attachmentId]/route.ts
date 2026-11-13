import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { mailProviderHttpError, resolveUserMailProvider } from "@/lib/magnimail/providers/resolve";

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\/]+/g, "_").slice(0, 180) || "piece-jointe";
}
function safeMimeType(value: string) {
  return /^[a-z\d][a-z\d.+-]*\/[a-z\d][a-z\d.+-]*$/i.test(value)
    ? value
    : "application/octet-stream";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string; attachmentId: string }> },
) {
  try {
    const { messageId, attachmentId } = await params;
    if (!messageId || !attachmentId || messageId.length > 512 || attachmentId.length > 512) {
      return NextResponse.json({ error: "Identifiants de pièce jointe invalides." }, { status: 400 });
    }

    const ctx = await requireOrganization();
    const connectionId = request.nextUrl.searchParams.get("connectionId");
    const { provider, context } = await resolveUserMailProvider(ctx, connectionId);

    if (!provider.capabilities.attachments) {
      return NextResponse.json({ error: "Ce fournisseur ne gère pas les pièces jointes." }, { status: 501 });
    }

    // Filename and MIME type come from the authorized mailbox, never the URL.
    const file = await provider.getAttachment({ context, messageId, attachmentId });
    const filename = safeFilename(file.filename);
    const mimeType = safeMimeType(file.mimeType);

    return new NextResponse(file.content as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(file.content.length),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("MGMail attachment failed", error);
    const detail = mailProviderHttpError(error);
    return NextResponse.json({ error: detail.error }, { status: detail.status });
  }
}
