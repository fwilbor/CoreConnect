import Link from "next/link";

// Shared layout for the privacy and terms pages.
export function LegalPage({ title, subtitle, effective, children }: {
  title: string; subtitle?: string; effective: string; children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-[15px] leading-relaxed">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle && <p className="mt-1 text-neutral-600 dark:text-neutral-300">{subtitle}</p>}
      <p className="mt-1 text-sm text-neutral-500">Effective {effective}</p>
      <div className="legal mt-6 space-y-4 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </main>
  );
}

// Links under every public page of a workspace: the inquiry form, application and deposit.
export function PublicFooter({ slug, small = false }: { slug: string; small?: boolean }) {
  return (
    <footer className={`${small ? "mt-4" : "mt-10"} text-center text-xs text-neutral-500`}>
      <Link href={`/${slug}/privacy`} className="underline" target={small ? "_blank" : undefined}>Privacy policy</Link>
      {" · "}
      <Link href={`/${slug}/terms`} className="underline" target={small ? "_blank" : undefined}>Terms</Link>
      {" · "}
      <span>Powered by <Link href="/privacy" className="underline" target={small ? "_blank" : undefined}>CoreConnect</Link></span>
    </footer>
  );
}
