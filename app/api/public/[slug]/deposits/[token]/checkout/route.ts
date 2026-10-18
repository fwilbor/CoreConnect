import { NextResponse, type NextRequest } from "next/server";
import { startDepositCheckout } from "@/lib/deposits";
import { siteUrl } from "@/lib/messaging/send";
import { StripeError } from "@/lib/stripe";

// POST /api/public/:slug/deposits/:token/checkout: create a Stripe Checkout
// session and redirect to it (or return {url} to JSON clients). Auth: the
// signed deposit token.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  let agreed = false;
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    agreed = ((await request.json().catch(() => ({}))) as { agree?: unknown }).agree === true;
  } else {
    agreed = (await request.formData()).get("agree") === "yes";
  }

  const back = (error: string) => NextResponse.redirect(`${siteUrl()}/${slug}/deposit/${token}?error=${error}`, 303);
  try {
    const result = await startDepositCheckout({ slug, token, agreedToTerms: agreed });
    if (result.ok) return wantsJson ? NextResponse.json({ url: result.url }) : NextResponse.redirect(result.url, 303);
    if (wantsJson) return NextResponse.json({ error: { code: result.reason, message: result.reason } }, { status: result.reason === "not_found" ? 404 : 400 });
    return back(result.reason === "terms" ? "terms" : "unavailable");
  } catch (err) {
    if (!(err instanceof StripeError)) throw err;
    console.error("checkout failed", err.message);
    return wantsJson ? NextResponse.json({ error: { code: "stripe", message: "Payment could not start" } }, { status: 502 }) : back("failed");
  }
}
