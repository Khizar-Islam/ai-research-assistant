"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRODUCT_NAME } from "@/lib/config";
import { UserMenu } from "./UserMenu";

const NAV = [
  { href: "/dashboard", label: "Documents" },
  { href: "/chat", label: "Ask" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-5 sm:gap-8 sm:px-8">
        <Link href="/" className="font-serif text-2xl tracking-tight">
          {PRODUCT_NAME}
          <sup className="ml-0.5 font-mono text-xs text-mark">1</sup>
        </Link>

        <nav aria-label="Main" className="flex gap-3 text-sm sm:gap-6">
          {NAV.map(({ href, label }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`underline-offset-[6px] hover:underline ${active ? "text-ink underline decoration-mark decoration-2" : "text-ink-soft"}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <UserMenu />
      </div>
    </header>
  );
}
