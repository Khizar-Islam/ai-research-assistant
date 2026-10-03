"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DEV_USER_EMAIL, PRODUCT_NAME } from "@/lib/config";

const NAV = [
  { href: "/dashboard", label: "Documents" },
  { href: "/chat", label: "Ask" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-8 px-5 sm:px-8">
        <Link href="/" className="font-serif text-2xl tracking-tight">
          {PRODUCT_NAME}
          <sup className="ml-0.5 font-mono text-xs text-mark">1</sup>
        </Link>

        <nav aria-label="Main" className="flex gap-6 text-sm">
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

        {/* Step 8: replaced by the signed-in user and a sign-out button. Until then every
            request runs as one fixed development user, and the UI says so. */}
        <p
          className="ml-auto hidden border border-rule px-2 py-1 font-mono text-[11px] text-ink-soft sm:block"
          title="No sign-in yet: every request runs as one development user"
        >
          dev mode · {DEV_USER_EMAIL}
        </p>
      </div>
    </header>
  );
}
