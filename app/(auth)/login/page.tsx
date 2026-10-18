import { sendMagicLink } from "./actions";

export const metadata = { title: "Sign in · CoreConnect" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Sign in to CoreConnect</h1>
      {sent ? (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
          If that email has an account, a sign-in link is on its way. It works once and expires in an hour.
        </p>
      ) : (
        <form action={sendMagicLink} className="mt-6 space-y-3">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base dark:border-neutral-700"
          />
          {error === "email" && <p className="text-sm text-red-600">Enter a valid email address.</p>}
          {error === "link" && (
            <p className="text-sm text-red-600">That sign-in link is invalid or has expired. Request a new one.</p>
          )}
          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white dark:bg-white dark:text-neutral-900"
          >
            Email me a sign-in link
          </button>
        </form>
      )}
    </main>
  );
}
