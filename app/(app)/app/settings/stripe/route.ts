import { NextResponse, type NextRequest } from "next/server";
import { getWorkspaceContext } from "@/lib/workspace";
import { requireUser } from "@/lib/auth";
import { connectOnboardingUrl, refreshConnectStatus } from "@/lib/deposits";
import { siteUrl } from "@/lib/messaging/send";

// Stripe sends owners back here from Connect onboarding: ?return=1 when they
// finish (or leave), ?refresh=1 when the link expired and needs a new one.
export async function GET(request: NextRequest) {
  const ctx = await getWorkspaceContext(await requireUser());
  if (!ctx || ctx.workspace.role === "staff") return NextResponse.redirect(`${siteUrl()}/app`);
  const { workspace, user } = ctx;

  if (request.nextUrl.searchParams.get("refresh")) {
    const url = await connectOnboardingUrl({ workspaceId: workspace.id, ownerEmail: user.email, businessName: workspace.name });
    return NextResponse.redirect(url);
  }
  const enabled = await refreshConnectStatus(workspace.id);
  return NextResponse.redirect(`${siteUrl()}/app/settings?stripe=${enabled ? "connected" : "pending"}`);
}
