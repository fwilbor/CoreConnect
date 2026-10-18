"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LoginInput = z.object({ email: z.email().trim().toLowerCase() });

export async function sendMagicLink(formData: FormData) {
  const parsed = LoginInput.safeParse({ email: formData.get("email") });
  if (!parsed.success) redirect("/login?error=email");

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const supabase = await createSupabaseServerClient();
  // shouldCreateUser: false — accounts come only from a workspace invite. The
  // result is ignored so the page never reveals which emails have accounts.
  await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm?next=/app` },
  });
  redirect("/login?sent=1");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
