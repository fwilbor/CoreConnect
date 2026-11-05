"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LoginInput = z.object({ email: z.email().trim().toLowerCase() });
const CodeInput = z.object({ email: z.email().trim().toLowerCase(), code: z.string().trim().regex(/^\d{6,10}$/) });

export type LoginState =
  | { step: "email"; error?: string }
  | { step: "sent"; email: string; error?: string };

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginInput.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { step: "email", error: "Enter a valid email address." };

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const supabase = await createSupabaseServerClient();
  // shouldCreateUser: false: accounts come only from a workspace invite. The
  // page says "sent" whether or not the email has an account, so it never
  // reveals which emails do. Sending limits are project-wide, not per account,
  // so saying so reveals nothing and saves people waiting for an email that
  // isn't coming.
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm?next=/app` },
  });
  if (error?.code === "over_email_send_rate_limit" || error?.status === 429) {
    console.error(`magic link failed: ${error.status} ${error.code} ${error.message}`);
    const wait = error.message.match(/after (\d+) seconds/)?.[1];
    return {
      step: "email",
      error: wait
        ? `Please wait ${wait} seconds before asking for another sign-in email.`
        : "Too many sign-in emails were sent in the last hour. Please try again later, or use the newest email you already have.",
    };
  }
  if (error && error.code !== "otp_disabled") {
    console.error(`magic link failed: ${error.status} ${error.code} ${error.message}`);
  }
  return { step: "sent", email: parsed.data.email };
}

// The 8-digit code from the sign-in email: works on any device, whichever
// browser the email is opened in.
export async function verifyCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const parsed = CodeInput.safeParse({ email, code: formData.get("code") });
  if (!parsed.success) return { step: "sent", email, error: "Enter the code from the email, numbers only." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.code, type: "email" });
  if (error) {
    console.error(`sign-in code failed: ${error.status ?? ""} ${error.code ?? ""} ${error.message}`);
    return { step: "sent", email, error: "That code didn't work. Check it, or use the code from the newest email (each new email replaces the last)." };
  }
  redirect("/app");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
