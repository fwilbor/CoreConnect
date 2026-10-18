import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, type Database } from "@/lib/db";
import { createWorkspace, CreateWorkspaceInput } from "@/lib/workspaces/create";
import { TEST_DATABASE_URL } from "../global-setup";

let db: Database;
const adminId = randomUUID();

// Stands in for Supabase's inviteUserByEmail: creates the auth user, which the
// on_auth_user_created trigger copies into public.users.
const inviteOwner = vi.fn(async (email: string) => {
  const id = randomUUID();
  await db.execute(sql`insert into auth.users (id, email) values (${id}, ${email})`);
  return id;
});

const input = (overrides: Partial<CreateWorkspaceInput> = {}) =>
  CreateWorkspaceInput.parse({
    name: "Riverbend Labradors",
    slug: `riverbend-${randomUUID().slice(0, 8)}`,
    businessType: "breeder",
    timezone: "America/Chicago",
    ownerEmail: `owner-${randomUUID().slice(0, 8)}@example.com`,
    ...overrides,
  });

beforeAll(async () => {
  db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`insert into auth.users (id, email) values (${adminId}, 'admin@example.com')`);
});

afterAll(async () => {
  await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe("createWorkspace", () => {
  it("invites a new owner, makes them owner, seeds the workspace and audits it", async () => {
    const data = input();
    const result = await createWorkspace(db, data, adminId, inviteOwner);
    expect(result).toMatchObject({ ok: true, invited: true });
    if (!result.ok) return;

    const [check] = await db.execute(sql`
      select
        (select role from memberships m join users u on u.id = m.user_id
          where m.workspace_id = ${result.workspaceId} and u.email = ${data.ownerEmail}) as owner_role,
        (select count(*)::int from pipeline_stages where workspace_id = ${result.workspaceId}) as stages,
        (select count(*)::int from litters where workspace_id = ${result.workspaceId} and is_general) as general,
        (select action from audit_log where workspace_id = ${result.workspaceId}) as audit`);
    expect(check).toEqual({ owner_role: "owner", stages: 9, general: 1, audit: "workspace.create" });
  });

  it("reuses an existing user instead of inviting again", async () => {
    const first = input();
    await createWorkspace(db, first, adminId, inviteOwner);
    inviteOwner.mockClear();
    const second = await createWorkspace(db, input({ ownerEmail: first.ownerEmail }), adminId, inviteOwner);
    expect(second).toMatchObject({ ok: true, invited: false });
    expect(inviteOwner).not.toHaveBeenCalled();
  });

  it("rejects a taken slug before inviting anyone", async () => {
    const first = input();
    await createWorkspace(db, first, adminId, inviteOwner);
    inviteOwner.mockClear();
    const result = await createWorkspace(db, input({ slug: first.slug }), adminId, inviteOwner);
    expect(result).toEqual({ ok: false, error: "slug_taken" });
    expect(inviteOwner).not.toHaveBeenCalled();
  });

  it("validates slugs and time zones", () => {
    expect(() => input({ slug: "Bad Slug" })).toThrow();
    expect(() => input({ slug: "a--b" })).toThrow();
    expect(() => input({ slug: "admin" })).toThrow();
    expect(() => input({ timezone: "Mars/Olympus" })).toThrow();
  });
});
