"use client";

import { useActionState, useState } from "react";
import { useSubmitKeepingValues } from "@/lib/forms-client";
import { sendMagicLink, verifyCode, type LoginState } from "./actions";

const input = "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base aria-[invalid=true]:border-red-600 dark:border-neutral-700";
const button = "w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900";

// Step 1: email. Step 2: check your email, with the code box when the sign-in
// email carries a code (withCode: AUTH_EMAIL_HAS_CODE, set once custom SMTP
// and templates are live).
export function LoginForm({ withCode, linkError }: { withCode: boolean; linkError: boolean }) {
  const [sent, sendAction, sending] = useActionState<LoginState, FormData>(sendMagicLink, { step: "email" });
  const [checked, codeAction, checking] = useActionState<LoginState, FormData>(verifyCode, { step: "email" });
  const [again, setAgain] = useState(false);
  const onSend = useSubmitKeepingValues((fd) => { setAgain(false); sendAction(fd); });
  const onCode = useSubmitKeepingValues(codeAction);

  if (sent.step === "sent" && !again) {
    const error = checked.step === "sent" ? checked.error : undefined;
    return (
      <div className="mt-6">
        <p className="text-neutral-700 dark:text-neutral-200" role="status">
          If <span className="font-medium">{sent.email}</span> has an account, we&apos;ve emailed it a sign-in{" "}
          {withCode ? "code and link" : "link"}.
        </p>
        {withCode ? (
          <form onSubmit={onCode} className="mt-5 space-y-3" noValidate>
            <input type="hidden" name="email" value={sent.email} />
            <label htmlFor="code" className="block text-sm font-medium">Code from the email</label>
            <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d*" maxLength={10} required autoFocus
              className={`${input} tracking-[0.3em]`} aria-invalid={error ? true : undefined} aria-describedby={error ? "code-error" : undefined} />
            {error && <p id="code-error" className="text-sm text-red-600" role="alert">{error}</p>}
            <button disabled={checking} className={button}>{checking ? "Checking…" : "Sign in"}</button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">
            Open the link in <span className="font-medium">this browser</span>. It works once and expires in an hour.
            Each new email replaces the last one.
          </p>
        )}
        <button onClick={() => setAgain(true)} className="mt-5 text-sm text-neutral-600 underline dark:text-neutral-300">
          Use a different email, or send another
        </button>
      </div>
    );
  }

  const error = sent.step === "email" ? sent.error : undefined;
  return (
    <form onSubmit={onSend} className="mt-6 space-y-3" noValidate>
      {linkError && !error && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100" role="alert">
          That sign-in link didn&apos;t work. It may have expired, been used already, or been replaced by a newer email
          {withCode ? "" : ", or it was opened in a different browser from the one that asked for it"}. Ask for a new one below.
        </p>
      )}
      <label htmlFor="email" className="block text-sm font-medium">Email</label>
      <input id="email" name="email" type="email" required autoComplete="email" autoFocus className={input}
        aria-invalid={error ? true : undefined} aria-describedby={error ? "email-error" : undefined} />
      {error && <p id="email-error" className="text-sm text-red-600" role="alert">{error}</p>}
      <button disabled={sending} className={button}>{sending ? "Sending…" : `Email me a sign-in ${withCode ? "code" : "link"}`}</button>
    </form>
  );
}
