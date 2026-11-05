import { signOut } from "@/app/(auth)/login/actions";
import { requireUser } from "@/lib/auth";
import { getWorkspaceContext } from "@/lib/workspace";
import { switchWorkspace } from "./actions";
import { NavLinks, type NavItem } from "./nav-links";

// Staff can't open Settings (owner-only), so they get their one personal
// setting instead of a link that bounces them back to Today.
function navFor(role: string, service: boolean): NavItem[] {
  return [
    { href: "/app", label: "Today" },
    { href: "/app/dashboard", label: "Dashboard" },
    { href: "/app/leads", label: "Leads" },
    { href: "/app/inbox", label: "Inbox" },
    { href: "/app/litters", label: service ? "Slots" : "Litters" },
    { href: "/app/leads/new", label: "Quick add" },
    { href: "/app/import", label: "Import" },
    role === "staff"
      ? { href: "/app/settings/notifications", label: "Notifications" }
      : { href: "/app/settings", label: "Settings" },
  ];
}

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
            <NavLinks items={navFor(ctx.workspace.role, ctx.workspace.businessType === "service")} />
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
