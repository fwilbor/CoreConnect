import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · CoreConnect" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">Sign in to CoreConnect</h1>
      {/* The sign-in email includes a typeable code once custom SMTP and the
          templates in supabase/templates are live (see supabase/config.toml). */}
      <LoginForm withCode={process.env.AUTH_EMAIL_HAS_CODE === "true"} linkError={error === "link"} />
    </main>
  );
}
