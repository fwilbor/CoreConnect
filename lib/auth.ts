import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { serviceDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string };

// The verified user for this request, or a redirect to /login. getUser()
// checks the token with Supabase Auth rather than trusting the cookie.
export async function requireUser(): Promise<SessionUser> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { id: data.user.id, email: data.user.email ?? "" };
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  const [row] = await serviceDb()
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, user.id));
  if (!row?.isPlatformAdmin) redirect("/app");
  return user;
}
