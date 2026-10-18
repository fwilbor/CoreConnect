import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/lib/db";
import { users, workspaces } from "@/lib/db/schema";

// Public forms live at /{slug}/inquire, so a slug can't shadow an app route.
export const RESERVED_SLUGS = new Set([
  "app", "admin", "api", "auth", "login", "logout", "embed", "static", "public", "settings",
  "_next", "favicon", "robots", "sitemap", "help", "support", "www", "coreconnect", "corestore",
]);

export const CreateWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9](-?[a-z0-9])*$/, "Use lowercase letters, numbers and single hyphens")
    .refine((slug) => !RESERVED_SLUGS.has(slug), "That slug is reserved"),
  businessType: z.enum(["breeder", "service"]),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Unknown time zone"),
  ownerEmail: z.email().trim().toLowerCase(),
  ownerName: z.string().trim().max(120).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInput>;

// Returns the auth user id for a new owner (Supabase sends the invite email).
export type InviteOwner = (email: string, name: string | undefined) => Promise<string>;

export type CreateWorkspaceResult =
  | { ok: true; workspaceId: string; invited: boolean }
  | { ok: false; error: "slug_taken" };

export async function createWorkspace(
  db: Database,
  input: CreateWorkspaceInput,
  actorUserId: string,
  inviteOwner: InviteOwner,
): Promise<CreateWorkspaceResult> {
  // Check the slug before inviting anyone, so a taken slug doesn't leave an
  // invited owner with no workspace. The unique constraint still decides races.
  const [taken] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, input.slug));
  if (taken) return { ok: false, error: "slug_taken" };

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.ownerEmail));
  const ownerId = existing?.id ?? (await inviteOwner(input.ownerEmail, input.ownerName));

  try {
    const [row] = await db.execute(sql`
      select app.create_workspace(${input.name}, ${input.slug}, ${input.businessType},
                                  ${input.timezone}, ${ownerId}, ${actorUserId}) as id`);
    return { ok: true, workspaceId: (row as { id: string }).id, invited: !existing };
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    if (code === "23505") return { ok: false, error: "slug_taken" };
    throw err;
  }
}
