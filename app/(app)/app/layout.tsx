import Link from "next/link";
import { signOut } from "@/app/(auth)/login/actions";
import { requireUser } from "@/lib/auth";
import { getWorkspaceContext } from "@/lib/workspace";
import { switchWorkspace } from "./actions";

const NAV = [
  { href: "/app", label: "Today" },
  { href: "/app/leads", label: "Leads" },
  { href: "/app/leads/new", label: "Quick add" },
  { href: "/app/import", label: "Import" },
  { href: "/app/settings/forms", label: "Forms" },
  { href: "/app/settings/stages", label: "Stages" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getWorkspaceContext(await requireUser());

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          {ctx && ctx.all.length > 1 ? (
            <form action={switchWorkspace} className="flex items-center gap-2">
              <select
                name="workspaceId"
                defaultValue={ctx.workspace.id}
                aria-label="Workspace"
                className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm font-semibold dark:border-neutral-700"
              >
                {ctx.all.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <button className="text-sm underline">Switch</button>
            </form>
          ) : (
            <span className="font-semibold">{ctx?.workspace.name ?? "CoreConnect"}</span>
          )}
          {ctx && (
            <nav className="flex flex-wrap gap-3 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white">
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
          <form action={signOut} className="ml-auto">
            <button className="text-sm text-neutral-500 underline">Sign out</button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
