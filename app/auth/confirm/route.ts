import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Landing page for magic links and invites. Handles both Supabase link styles:
// ?code= (PKCE, the default) and ?token_hash=&type= (custom email templates).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = params.get("next");
  // Only same-site paths, so the link can't redirect somewhere else.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/app";

  const supabase = await createSupabaseServerClient();
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing code") };

  const url = request.nextUrl.clone();
  url.search = "";
  url.pathname = error ? "/login" : destination;
  if (error) url.searchParams.set("error", "link");
  return NextResponse.redirect(url);
}
