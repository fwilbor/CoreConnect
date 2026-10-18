import { NextResponse, type NextRequest } from "next/server";
import { serviceDb } from "@/lib/db";
import { unsubscribeEmail } from "@/lib/messaging/inbound";
import { verifyToken } from "@/lib/tokens";

// RFC 8058 one-click unsubscribe: mail apps POST here from the
// List-Unsubscribe header without showing a page.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const contactId = verifyToken((await params).token, "unsubscribe");
  if (!contactId) return NextResponse.json({ error: { code: "invalid_token", message: "Link is invalid" } }, { status: 400 });
  await unsubscribeEmail(serviceDb(), contactId, "link");
  return new NextResponse(null, { status: 204 });
}
