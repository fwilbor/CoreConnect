// Bootstraps the first platform admin: invites the email through Supabase Auth
// (or finds the existing account) and sets users.is_platform_admin.
//
//   pnpm tsx scripts/invite-platform-admin.ts you@example.com
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("usage: invite-platform-admin.ts <email>");
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, DATABASE_URL: dbUrl, NEXT_PUBLIC_SITE_URL: site } =
    process.env;
  if (!url || !key || !dbUrl) throw new Error("Supabase URL, secret key and DATABASE_URL must be set in .env.local");

  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    const [existing] = await sql<{ id: string }[]>`select id from public.users where email = ${email}`;
    if (!existing) {
      const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${site ?? "http://localhost:3000"}/auth/confirm?next=/app`,
      });
      if (error) throw new Error(`invite failed: ${error.message}`);
      console.log(`invited ${email}`);
    } else {
      console.log(`${email} already has an account`);
    }
    const updated = await sql`update public.users set is_platform_admin = true where email = ${email} returning id`;
    if (updated.length !== 1) throw new Error("user row not found after invite");
    console.log(`${email} is a platform admin`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
