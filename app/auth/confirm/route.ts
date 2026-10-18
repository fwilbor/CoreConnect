import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Landing page for magic links and invites. Handles all three Supabase link styles:
// ?code= (PKCE magic links), ?token_hash=&type= (custom email templates, which
// need custom SMTP), and #access_token= (default invite emails).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = params.get("next");
  // Only same-site paths, so the link can't redirect somewhere else.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/app";

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  // No token in the query: it's in the #fragment, which only the browser can
  // read. Browsers keep the fragment across this redirect.
  if (!code && !(tokenHash && type)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    url.search = "";
    url.searchParams.set("next", destination);
    return NextResponse.redirect(url);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type! });

  const url = request.nextUrl.clone();
  url.search = "";
  url.pathname = error ? "/login" : destination;
  if (error) url.searchParams.set("error", "link");
  return NextResponse.redirect(url);
}
