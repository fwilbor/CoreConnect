import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { serviceDb } from "@/lib/db";
import { unsubscribeEmail } from "@/lib/messaging/inbound";
import { verifyToken } from "@/lib/tokens";

export const metadata = { title: "Unsubscribe" };

// The unsubscribe link in every email footer. A GET only shows the page (mail
// scanners follow links); the button does the unsubscribe.
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const [{ token }, { done }] = await Promise.all([params, searchParams]);
  const contactId = verifyToken(token, "unsubscribe");
  const [row] = contactId
    ? await serviceDb().execute(sql`
        select w.name, c.email_unsubscribed_at is not null as unsubscribed
        from contacts c join workspaces w on w.id = c.workspace_id where c.id = ${contactId}`)
    : [];
  const info = row as { name: string; unsubscribed: boolean } | undefined;

  async function unsubscribe() {
    "use server";
    const id = verifyToken(token, "unsubscribe");
    if (id) await unsubscribeEmail(serviceDb(), id, "link");
    redirect(`/u/${token}?done=1`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      {!info ? (
        <p>This unsubscribe link is invalid or has expired.</p>
      ) : info.unsubscribed || done ? (
        <>
          <h1 className="text-xl font-semibold">You&apos;re unsubscribed</h1>
          <p className="mt-2 text-neutral-600 dark:text-neutral-300">You won&apos;t get more emails from {info.name}.</p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Unsubscribe from {info.name}?</h1>
          <p className="mt-2 text-neutral-600 dark:text-neutral-300">You&apos;ll stop getting emails from them through CoreConnect.</p>
          <form action={unsubscribe} className="mt-4">
            <button className="rounded-md bg-neutral-900 px-4 py-2 text-white dark:bg-white dark:text-neutral-900">Unsubscribe</button>
          </form>
        </>
      )}
    </main>
  );
}
