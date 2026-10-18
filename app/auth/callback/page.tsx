"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Finishes sign-in for links that carry the session in the URL fragment
// (#access_token=…), which is what Supabase's default invite email sends.
// The fragment never reaches the server, so this has to run in the browser.
// setSession() checks the token with Supabase Auth and writes the session
// cookies the server reads.
export default function AuthCallbackPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const next = new URLSearchParams(window.location.search).get("next");
    const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/app";
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");

    // Clear the tokens from the address bar and history either way.
    window.history.replaceState(null, "", window.location.pathname);

    if (!accessToken || !refreshToken) {
      setFailed(true);
      return;
    }
    createSupabaseBrowserClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) setFailed(true);
        else window.location.replace(destination);
      });
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      {failed ? (
        <>
          <h1 className="text-xl font-semibold">That link didn&apos;t work</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Sign-in links work once and expire after an hour. Request a new one and use it on this device.
          </p>
          <Link href="/login" className="mt-4 text-sm underline">
            Get a new sign-in link
          </Link>
        </>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-300">Signing you in…</p>
      )}
    </main>
  );
}
