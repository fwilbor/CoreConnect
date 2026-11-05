"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

// Highlights where you are. The longest matching link wins, so on
// /app/leads/new it's "Quick add" that's current, not "Leads".
export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const current = items
    .filter((n) => path === n.href || (n.href !== "/app" && path.startsWith(`${n.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Main" className="order-last -mx-4 basis-[calc(100%+2rem)] overflow-x-auto px-4 sm:order-none sm:mx-0 sm:basis-auto sm:px-0">
      <ul className="flex gap-1 whitespace-nowrap text-sm">
        {items.map((n) => {
          const active = n.href === current;
          return (
            <li key={n.href}>
              <Link href={n.href} aria-current={active ? "page" : undefined}
                className={`block rounded-md px-2 py-1 ${active
                  ? "bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"}`}>
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
