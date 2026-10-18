import { eq } from "drizzle-orm";
import { signOut } from "@/app/(auth)/login/actions";
import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { memberships, workspaces } from "@/lib/db/schema";

export const metadata = { title: "Today · CoreConnect" };

// Placeholder home for week 1: proves login and RLS end to end by listing the
// workspaces this user belongs to. The Today screen replaces it in week 6.
export default async function AppHome() {
  const user = await requireUser();
  const rows = await withUser(user.id, (tx) =>
    tx
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: memberships.role })
      .from(workspaces)
      .innerJoin(memberships, eq(memberships.workspaceId, workspaces.id))
      .where(eq(memberships.userId, user.id)),
  );

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Today</h1>
        <form action={signOut}>
          <button className="text-sm text-neutral-500 underline">Sign out</button>
        </form>
      </div>
      <p className="mt-2 text-sm text-neutral-500">Signed in as {user.email}</p>

      {rows.length === 0 ? (
        <p className="mt-6">You aren&apos;t a member of any workspace yet.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {rows.map((w) => (
            <li key={w.id} className="rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800">
              <span className="font-medium">{w.name}</span>{" "}
              <span className="text-sm text-neutral-500">/{w.slug} · {w.role}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
