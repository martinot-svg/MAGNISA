import { NextRequest, NextResponse } from "next/server";
import { requireOrganization } from "@/lib/current-org";
import { getGmailAccess, gmailJson } from "@/lib/google/gmail";

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\/]+/g, "_").slice(0, 180) || "piece-jointe";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string; attachmentId: string }> },
) {
  try {
    const { messageId, attachmentId } = await params;
    const { organizationId, user } = await requireOrganization();
    const { accessToken } = await getGmailAccess(organizationId, user.id);
    const data = await gmailJson<{ data?: string; size?: number }>(
      accessToken,
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );

    if (!data.data) {
      return NextResponse.json({ error: "Pièce jointe introuvable." }, { status: 404 });
    }

    const url = new URL(request.url);
    const filename = safeFilename(url.searchParams.get("filename") || "piece-jointe");
    const mimeType = String(url.searchParams.get("mimeType") || "application/octet-stream");
    const buffer = Buffer.from(data.data, "base64url");

    return new NextResponse(buffer as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("MagniMail attachment failed", error);
    const message = error instanceof Error ? error.message : "Téléchargement impossible.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
