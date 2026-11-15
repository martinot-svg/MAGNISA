import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Retired legacy provider callback. Incoming Internet mail is accepted by the
 * MAGNIBOX-owned SMTP edge and delivered through /api/internal/magnibox/inbound
 * using the signed private MTA bridge. No Resend webhook is accepted.
 */
export async function POST() {
  return NextResponse.json({
    ok: false,
    error: "Cette ancienne passerelle est désactivée. Utilisez le transport natif MAGNIBOX.",
  }, { status: 410 });
}
