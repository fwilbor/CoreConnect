import { requireUser } from "@/lib/auth";

export default async function NoWorkspacePage() {
  const user = await requireUser();
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold">No workspace yet</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-300">
        {user.email} isn&apos;t a member of any workspace. Ask the workspace owner to add you, or contact CoreStore support.
      </p>
    </main>
  );
}
