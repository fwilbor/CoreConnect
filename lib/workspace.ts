import "server-only";
import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { memberships, workspaces } from "@/lib/db/schema";

export const WORKSPACE_COOKIE = "cc_ws";

export type CurrentWorkspace = {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  role: "owner" | "staff" | "support";
};

export type WorkspaceContext = { user: SessionUser; workspace: CurrentWorkspace; all: CurrentWorkspace[] };

// The signed-in user and the workspace they are working in: the one in the
// cc_ws cookie if they are still a member, else their first. The cookie only
// picks among the user's own memberships; RLS still guards every query.
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const ctx = await getWorkspaceContext(await requireUser());
  if (!ctx) redirect("/app/no-workspace");
  return ctx;
}

// Same, but null when the user belongs to no workspace.
export async function getWorkspaceContext(user: SessionUser): Promise<WorkspaceContext | null> {
  const all = (await withUser(user.id, (tx) =>
    tx
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, businessType: workspaces.businessType,
                role: memberships.role })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, user.id))
      .orderBy(asc(workspaces.name)),
  )) as CurrentWorkspace[];
  if (all.length === 0) return null;

  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const workspace = all.find((w) => w.id === preferred) ?? all[0];
  return { user, workspace, all };
}

export async function requireOwner() {
  const ctx = await requireWorkspace();
  if (ctx.workspace.role === "staff") redirect("/app?error=owner_only");
  return ctx;
}
