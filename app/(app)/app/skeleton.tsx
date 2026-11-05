// Placeholder shapes shown while a page's data loads (loading.tsx files).
// Pulses only when the user hasn't asked for reduced motion.
export function Bone({ className = "" }: { className?: string }) {
  return <div className={`rounded-md bg-neutral-200/70 motion-safe:animate-pulse dark:bg-neutral-800 ${className}`} />;
}

export function SkeletonPage({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className={`mx-auto px-4 py-6 ${wide ? "max-w-[100rem]" : "max-w-5xl"}`} role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div aria-hidden>{children}</div>
    </main>
  );
}
